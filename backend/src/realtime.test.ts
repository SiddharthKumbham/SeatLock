import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { before, after, test } from "node:test";
import { io as clientIo, type Socket } from "socket.io-client";
import { app } from "./server.js";
import { pool } from "./db.js";
import { attachRealtime, closeRealtime, type AvailabilityNotice } from "./realtime.js";

const tag = randomUUID();
const origin = process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";
const ids = [`rt-a-${tag}`, `rt-b-${tag}`];
const emails = [`rt-a-${tag}@example.test`, `rt-b-${tag}@example.test`];
const password = `Test-only-${randomUUID()}!`;
let http: HttpServer;
let io: ReturnType<typeof attachRealtime>;
let base: string;
let auditoriums: string[] = [];
let seats: string[] = [];
let cookies: string[] = [];
let clients: Socket[] = [];
const writeHeaders = { Origin: origin, "X-SeatLock-Request": "1", "Content-Type": "application/json" };
const post = (path: string, body: object, cookie?: string) => fetch(`${base}${path}`, { method: "POST", headers: { ...writeHeaders, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const remove = (path: string, cookie: string) => fetch(`${base}${path}`, { method: "DELETE", headers: { ...writeHeaders, Cookie: cookie } });
const payload = async (response: Response) => (await response.json()).data;
function waitEvent<T>(socket: Socket, name: string, timeout = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, listener); reject(new Error(`Timed out waiting for ${name}`)); }, timeout);
    const listener = (value: T) => { clearTimeout(timer); socket.off(name, listener); resolve(value); };
    socket.on(name, listener);
  });
}
function connect(extraOrigin = origin) {
  const socket = clientIo(base, { transports: ["websocket"], extraHeaders: { Origin: extraOrigin }, reconnection: false, autoConnect: false });
  clients.push(socket); socket.connect(); return socket;
}
async function join(socket: Socket, showtimeId: string) {
  const reply = await socket.timeout(2000).emitWithAck("showtime:join", showtimeId) as { ok: boolean; error?: string };
  assert.equal(reply.ok, true);
}

before(async () => {
  await pool.query("SELECT 1");
  http = createServer(app); io = attachRealtime(http); http.listen(0);
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const address = http.address(); if (!address || typeof address === "string") throw new Error("Expected TCP server");
  base = `http://127.0.0.1:${address.port}`;
  for (const [index, showtimeId] of ids.entries()) {
    const room = await pool.query<{ id: string }>("INSERT INTO auditoriums(name) VALUES ($1) RETURNING id", [`Realtime Test ${index} ${tag}`]);
    auditoriums.push(room.rows[0].id);
    await pool.query("INSERT INTO showtimes(id,movie_id,auditorium_id,starts_at,base_price,format) VALUES ($1,'afterlight',$2,clock_timestamp()+interval '2 days',15,'STANDARD')", [showtimeId, room.rows[0].id]);
    const seat = await pool.query<{ id: string }>("INSERT INTO seats(auditorium_id,row_label,seat_number) VALUES ($1,'A',1) RETURNING id", [room.rows[0].id]);
    seats.push(seat.rows[0].id);
  }
  for (const email of emails) {
    const response = await post("/api/auth/register", { name: "Realtime Test", email, password });
    assert.equal(response.status, 201);
    cookies.push(response.headers.get("set-cookie")!.split(";")[0]);
  }
});
after(async () => {
  for (const client of clients) client.disconnect();
  if (io) await closeRealtime(io);
  if (http?.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
  for (const showtimeId of ids) {
    await pool.query("DELETE FROM booking_seats WHERE showtime_id=$1", [showtimeId]);
    await pool.query("DELETE FROM seat_claims WHERE showtime_id=$1", [showtimeId]);
    await pool.query("DELETE FROM bookings WHERE showtime_id=$1", [showtimeId]);
    await pool.query("DELETE FROM seat_holds WHERE showtime_id=$1", [showtimeId]);
    await pool.query("DELETE FROM seats WHERE auditorium_id=(SELECT auditorium_id FROM showtimes WHERE id=$1)", [showtimeId]);
    await pool.query("DELETE FROM showtimes WHERE id=$1", [showtimeId]);
  }
  for (const auditorium of auditoriums) await pool.query("DELETE FROM auditoriums WHERE id=$1", [auditorium]);
  await pool.query("DELETE FROM users WHERE email=ANY($1::text[])", [emails]);
  await pool.end();
});

test("origin and showtime validation reject untrusted subscriptions", async () => {
  const bad = connect("https://untrusted.invalid");
  await waitEvent(bad, "connect_error");
  assert.equal(bad.connected, false);
  bad.disconnect();
  const good = connect(); await waitEvent(good, "connect");
  const invalid = await good.timeout(2000).emitWithAck("showtime:join", "../../bad") as { ok: boolean };
  const missing = await good.timeout(2000).emitWithAck("showtime:join", "missing-showtime") as { ok: boolean };
  assert.equal(invalid.ok, false); assert.equal(missing.ok, false);
  good.disconnect();
});
test("two clients receive committed hold and release updates; rooms stay isolated", async () => {
  const a = connect(), b = connect(), other = connect();
  await Promise.all([waitEvent(a, "connect"), waitEvent(b, "connect"), waitEvent(other, "connect")]);
  await Promise.all([join(a, ids[0]), join(b, ids[0]), join(other, ids[1])]);
  let unrelated = 0; other.on("availability:changed", () => unrelated++);
  const aNotice = waitEvent<AvailabilityNotice>(a, "availability:changed");
  const bNotice = waitEvent<AvailabilityNotice>(b, "availability:changed");
  const held = await post("/api/holds", { showtimeId: ids[0], seatIds: [seats[0]] }, cookies[0]);
  assert.equal(held.status, 201);
  const hold = await payload(held);
  const [first, second] = await Promise.all([aNotice, bNotice]);
  for (const notice of [first, second]) {
    assert.deepEqual(Object.keys(notice).sort(), ["changedAt", "reason", "showtimeId"]);
    assert.equal(notice.reason, "hold_created"); assert.equal(notice.showtimeId, ids[0]);
  }
  assert.equal((await payload(await fetch(`${base}/api/showtimes/${ids[0]}/availability`))).seats[0].status, "held");
  let failedWriteNotices = 0; b.on("availability:changed", () => failedWriteNotices++);
  assert.equal((await post("/api/holds", { showtimeId: ids[0], seatIds: [seats[0]] }, cookies[1])).status, 409);
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(failedWriteNotices, 0);
  const released = waitEvent<AvailabilityNotice>(b, "availability:changed");
  assert.equal((await remove(`/api/holds/${hold.id}`, cookies[0])).status, 204);
  assert.equal((await released).reason, "hold_released");
  assert.equal((await payload(await fetch(`${base}/api/showtimes/${ids[0]}/availability`))).seats[0].status, "available");
  const bHold = await post("/api/holds", { showtimeId: ids[0], seatIds: [seats[0]] }, cookies[1]);
  assert.equal(bHold.status, 201);
  assert.equal((await remove(`/api/holds/${(await payload(bHold)).id}`, cookies[1])).status, 204);
  assert.equal(unrelated, 0);
  a.disconnect(); b.disconnect(); other.disconnect();
  console.log("REALTIME two users: both saw hold, conflict enforced, release visible, other room saw 0 events");
});
test("clients cannot publish authoritative availability events", async () => {
  const sender = connect(), receiver = connect();
  await Promise.all([waitEvent(sender, "connect"), waitEvent(receiver, "connect")]);
  await Promise.all([join(sender, ids[0]), join(receiver, ids[0])]);
  let received = 0; receiver.on("availability:changed", () => received++);
  sender.emit("availability:changed", { showtimeId: ids[0], reason: "booking_confirmed" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(received, 0);
  sender.disconnect(); receiver.disconnect();
});
test("confirmation broadcasts booked state; reconnect recovers PostgreSQL state", async () => {
  const a = connect(), b = connect(), other = connect();
  await Promise.all([waitEvent(a, "connect"), waitEvent(b, "connect"), waitEvent(other, "connect")]);
  await Promise.all([join(a, ids[0]), join(b, ids[0]), join(other, ids[1])]);
  let unrelated = 0; other.on("availability:changed", () => unrelated++);
  const held = await post("/api/holds", { showtimeId: ids[0], seatIds: [seats[0]] }, cookies[0]);
  assert.equal(held.status, 201); const hold = await payload(held);
  const confirmationNotice = waitEvent<AvailabilityNotice>(b, "availability:changed");
  const confirmed = await post(`/api/holds/${hold.id}/confirm`, {}, cookies[0]);
  assert.equal(confirmed.status, 200); assert.equal((await confirmationNotice).reason, "booking_confirmed");
  assert.equal((await payload(await fetch(`${base}/api/showtimes/${ids[0]}/availability`))).seats[0].status, "booked");
  b.disconnect(); b.connect(); await waitEvent(b, "connect"); await join(b, ids[0]);
  assert.equal((await payload(await fetch(`${base}/api/showtimes/${ids[0]}/availability`))).seats[0].status, "booked");
  assert.equal(unrelated, 0);
  const otherNotice = waitEvent<AvailabilityNotice>(other, "availability:changed");
  const otherHold = await post("/api/holds", { showtimeId: ids[1], seatIds: [seats[1]] }, cookies[1]);
  assert.equal(otherHold.status, 201); assert.equal((await otherNotice).showtimeId, ids[1]);
  await remove(`/api/holds/${(await payload(otherHold)).id}`, cookies[1]);
  a.disconnect(); b.disconnect(); other.disconnect();
});
test("expiry becomes available without an event and client refresh observes it", async () => {
  const held = await post("/api/holds", { showtimeId: ids[1], seatIds: [seats[1]] }, cookies[0]);
  assert.equal(held.status, 201); const hold = await payload(held);
  await pool.query("UPDATE seat_holds SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [hold.id]);
  await pool.query("UPDATE seat_claims SET expires_at=clock_timestamp()-interval '1 second' WHERE hold_id=$1", [hold.id]);
  assert.equal((await payload(await fetch(`${base}/api/showtimes/${ids[1]}/availability`))).seats[0].status, "available");
  assert.equal((await payload(await fetch(`${base}/api/holds/${hold.id}`, { headers: { Cookie: cookies[0] } }))).status, "expired");
});
