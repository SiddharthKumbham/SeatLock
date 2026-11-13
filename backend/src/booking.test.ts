import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import type { Server } from "node:http";
import { app } from "./server.js";
import { pool } from "./db.js";

const tag = randomUUID();
const showtimeId = `booking-test-${tag}`;
const emails = [`booking-a-${tag}@example.test`, `booking-b-${tag}@example.test`];
const origin = process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";
let server: Server;
let base: string;
let auditoriumId: string;
let seats: string[] = [];
let cookies: string[] = [];
let userIds: string[] = [];
let password = `Test-only-${randomUUID()}!`;
const post = (path: string, body: object, cookie?: string) => fetch(`${base}${path}`, { method: "POST",
  headers: { Origin: origin, "X-SeatLock-Request": "1", "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const release = (id: string, cookie: string) => fetch(`${base}/api/holds/${id}`, { method: "DELETE", headers: { Origin: origin, "X-SeatLock-Request": "1", Cookie: cookie } });
const hold = (seatIds: string[], cookie: string) => post("/api/holds", { showtimeId, seatIds }, cookie);
const data = async (response: Response) => (await response.json()).data;

before(async () => {
  await pool.query("SELECT 1");
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected TCP server");
  base = `http://127.0.0.1:${address.port}`;
  const auditorium = await pool.query<{ id: string }>("INSERT INTO auditoriums(name) VALUES ($1) RETURNING id", [`Test Screen ${tag}`]);
  auditoriumId = auditorium.rows[0].id;
  await pool.query("INSERT INTO showtimes(id,movie_id,auditorium_id,starts_at,base_price,format) VALUES ($1,'afterlight',$2,clock_timestamp()+interval '1 day',17.50,'STANDARD')", [showtimeId, auditoriumId]);
  for (let number = 1; number <= 8; number++) {
    const seat = await pool.query<{ id: string }>("INSERT INTO seats(auditorium_id,row_label,seat_number) VALUES ($1,'T',$2) RETURNING id", [auditoriumId, number]);
    seats.push(seat.rows[0].id);
  }
  for (const email of emails) {
    const response = await post("/api/auth/register", { name: "Booking Test", email, password });
    assert.equal(response.status, 201);
    userIds.push((await response.json()).user.id);
    cookies.push(response.headers.get("set-cookie")!.split(";")[0]);
  }
});
after(async () => {
  if (auditoriumId) {
    await pool.query("DELETE FROM booking_seats WHERE showtime_id=$1", [showtimeId]);
    await pool.query("DELETE FROM seat_claims WHERE showtime_id=$1", [showtimeId]);
    await pool.query("DELETE FROM bookings WHERE showtime_id=$1", [showtimeId]);
    await pool.query("DELETE FROM seat_holds WHERE showtime_id=$1", [showtimeId]);
    await pool.query("DELETE FROM seats WHERE auditorium_id=$1", [auditoriumId]);
    await pool.query("DELETE FROM showtimes WHERE id=$1", [showtimeId]);
    await pool.query("DELETE FROM auditoriums WHERE id=$1", [auditoriumId]);
  }
  await pool.query("DELETE FROM users WHERE email=ANY($1::text[])", [emails]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  password = "";
});

test("unauthenticated and invalid requests are rejected", async () => {
  assert.equal((await hold([seats[0]], "")).status, 401);
  assert.equal((await hold(["999999999"], cookies[0])).status, 400);
  assert.equal((await hold([seats[0], seats[0]], cookies[0])).status, 400);
  const otherSeat = await pool.query<{ id: string }>("SELECT id FROM seats WHERE auditorium_id<>$1 LIMIT 1", [auditoriumId]);
  assert.equal((await hold([otherSeat.rows[0].id], cookies[0])).status, 400);
  assert.equal((await fetch(`${base}/api/bookings`)).status, 401);
});
test("two users competing for one seat produce exactly one hold", async () => {
  const responses = await Promise.all([hold([seats[0]], cookies[0]), hold([seats[0]], cookies[1])]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  const winner = responses.find((r) => r.status === 201)!;
  const owner = responses.indexOf(winner);
  const created = await data(winner);
  const count = await pool.query("SELECT 1 FROM seat_claims WHERE showtime_id=$1 AND seat_id=$2 AND state='held'", [showtimeId, seats[0]]);
  assert.equal(count.rowCount, 1);
  console.log("CONCURRENCY two users: 1 success, 1 conflict");
  assert.equal((await release(created.id, cookies[owner])).status, 204);
});
test("20 parallel requests for one seat produce one hold and 19 conflicts", async () => {
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => hold([seats[1]], cookies[i % 2])));
  const successes = responses.filter((r) => r.status === 201);
  const conflicts = responses.filter((r) => r.status === 409);
  assert.equal(successes.length, 1); assert.equal(conflicts.length, 19);
  const winner = successes[0]; const owner = responses.indexOf(winner) % 2;
  const created = await data(winner);
  assert.equal((await pool.query("SELECT 1 FROM seat_claims WHERE showtime_id=$1 AND seat_id=$2", [showtimeId, seats[1]])).rowCount, 1);
  console.log(`CONCURRENCY 20 contenders: ${successes.length} success, ${conflicts.length} conflicts`);
  assert.equal((await release(created.id, cookies[owner])).status, 204);
});
test("overlapping groups are atomic and a failed group claims no other seats", async () => {
  const responses = await Promise.all([hold([seats[2], seats[3]], cookies[0]), hold([seats[3], seats[4]], cookies[1])]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  const winner = responses.find((r) => r.status === 201)!;
  const owner = responses.indexOf(winner);
  const layout = await data(await fetch(`${base}/api/showtimes/${showtimeId}/availability`));
  assert.equal(layout.seats.filter((seat: { status: string }) => seat.status === "held").length, 2);
  const created = await data(winner);
  assert.equal((await release(created.id, cookies[owner])).status, 204);
  const occupied = await data(await hold([seats[5]], cookies[0]));
  assert.equal((await hold([seats[5], seats[6]], cookies[1])).status, 409);
  const after = await data(await fetch(`${base}/api/showtimes/${showtimeId}/availability`));
  assert.equal(after.seats.find((seat: { id: string }) => seat.id === seats[6]).status, "available");
  await release(occupied.id, cookies[0]);
});
test("expired holds can be reclaimed without cleanup and cannot be confirmed", async () => {
  const original = await data(await hold([seats[0]], cookies[0]));
  await pool.query("UPDATE seat_holds SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [original.id]);
  await pool.query("UPDATE seat_claims SET expires_at=clock_timestamp()-interval '1 second' WHERE hold_id=$1", [original.id]);
  const replacementResponse = await hold([seats[0]], cookies[1]);
  assert.equal(replacementResponse.status, 201);
  assert.equal((await post(`/api/holds/${original.id}/confirm`, {}, cookies[0])).status, 410);
  const replacement = await data(replacementResponse);
  assert.equal((await post(`/api/holds/${replacement.id}/confirm`, {}, cookies[0])).status, 404);
  assert.equal((await fetch(`${base}/api/holds/${replacement.id}`, { headers: { Cookie: cookies[0] } })).status, 404);
  assert.equal((await release(replacement.id, cookies[0])).status, 404);
  assert.equal((await release(replacement.id, cookies[1])).status, 204);
});
test("concurrent confirmations are idempotent and confirmed seats stay unavailable", async () => {
  const created = await data(await hold([seats[0], seats[1]], cookies[0]));
  assert.equal(created.total, 35);
  const responses = await Promise.all([post(`/api/holds/${created.id}/confirm`, {}, cookies[0]), post(`/api/holds/${created.id}/confirm`, {}, cookies[0])]);
  assert.deepEqual(responses.map((r) => r.status), [200, 200]);
  const confirmed = await Promise.all(responses.map(data));
  assert.equal(confirmed[0].id, confirmed[1].id);
  assert.equal(confirmed[0].seats.length, 2);
  assert.equal(confirmed[0].total, 35);
  assert.match(confirmed[0].paymentStatus, /No payment charged/);
  assert.equal((await data(await post(`/api/holds/${created.id}/confirm`, {}, cookies[0]))).id, confirmed[0].id);
  assert.equal((await pool.query("SELECT 1 FROM bookings WHERE hold_id=$1", [created.id])).rowCount, 1);
  assert.equal((await pool.query("SELECT 1 FROM booking_seats WHERE booking_id=$1", [confirmed[0].id])).rowCount, 2);
  const layout = await data(await fetch(`${base}/api/showtimes/${showtimeId}/availability`));
  assert.equal(layout.seats.find((seat: { id: string }) => seat.id === seats[0]).status, "booked");
  assert.equal((await hold([seats[0]], cookies[1])).status, 409);
  const mine = await data(await fetch(`${base}/api/bookings`, { headers: { Cookie: cookies[0] } }));
  const theirs = await data(await fetch(`${base}/api/bookings`, { headers: { Cookie: cookies[1] } }));
  assert.equal(mine.length, 1); assert.equal(theirs.length, 0);
  assert.equal((await fetch(`${base}/api/bookings/${confirmed[0].id}`, { headers: { Cookie: cookies[1] } })).status, 404);
  console.log("CONCURRENCY confirmation: 2 successful responses, 1 booking, 2 booked seats");
});
test("parallel hold-to-confirm workflows cannot double-book one physical seat", async () => {
  const outcomes = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
    const response = await hold([seats[7]], cookies[i % 2]);
    if (response.status !== 201) return { hold: response.status, confirmation: 0 };
    const created = await data(response);
    const confirmed = await post(`/api/holds/${created.id}/confirm`, {}, cookies[i % 2]);
    return { hold: response.status, confirmation: confirmed.status };
  }));
  assert.equal(outcomes.filter((item) => item.hold === 201 && item.confirmation === 200).length, 1);
  assert.equal(outcomes.filter((item) => item.hold === 409).length, 19);
  assert.equal((await pool.query("SELECT 1 FROM booking_seats WHERE showtime_id=$1 AND seat_id=$2", [showtimeId, seats[7]])).rowCount, 1);
  assert.equal((await pool.query("SELECT 1 FROM seat_claims WHERE showtime_id=$1 AND seat_id=$2 AND state='booked'", [showtimeId, seats[7]])).rowCount, 1);
  console.log("CONCURRENCY 20 hold-to-confirm workflows: 1 confirmed booking, 19 conflicts");
});
test("started showtimes reject new holds and confirmation", async () => {
  const pastId = `past-${tag}`;
  const crossingId = `crossing-${tag}`;
  await pool.query("INSERT INTO showtimes(id,movie_id,auditorium_id,starts_at,base_price,format) VALUES ($1,'afterlight',$2,clock_timestamp()-interval '1 hour',10,'STANDARD')", [pastId, auditoriumId]);
  await pool.query("INSERT INTO showtimes(id,movie_id,auditorium_id,starts_at,base_price,format) VALUES ($1,'afterlight',$2,clock_timestamp()+interval '1 hour',10,'STANDARD')", [crossingId, auditoriumId]);
  try {
    assert.equal((await post("/api/holds", { showtimeId: pastId, seatIds: [seats[0]] }, cookies[0])).status, 409);
    const response = await post("/api/holds", { showtimeId: crossingId, seatIds: [seats[0]] }, cookies[0]);
    assert.equal(response.status, 201);
    const created = await data(response);
    const blocker = await pool.connect();
    let confirmation: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await blocker.query("SELECT 1 FROM seat_claims WHERE hold_id=$1 FOR UPDATE", [created.id]);
      confirmation = post(`/api/holds/${created.id}/confirm`, {}, cookies[0]);
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE query LIKE 'SELECT seat_id FROM seat_claims%' AND $1::int = ANY(pg_blocking_pids(pid))", [pid]);
        blocked = !!result.rowCount;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(blocked, "Confirmation should reach the seat lock before the show starts");
      await pool.query("UPDATE showtimes SET starts_at=clock_timestamp() WHERE id=$1", [crossingId]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (confirmation) await confirmation;
    }
    assert.equal((await confirmation!).status, 409);
    assert.equal((await pool.query("SELECT 1 FROM bookings WHERE hold_id=$1", [created.id])).rowCount, 0);
    assert.equal((await post(`/api/holds/${created.id}/confirm`, {}, cookies[0])).status, 409);
    assert.equal((await release(created.id, cookies[0])).status, 204);
  } finally {
    await pool.query("DELETE FROM seat_claims WHERE showtime_id=ANY($1::text[])", [[pastId, crossingId]]);
    await pool.query("DELETE FROM seat_holds WHERE showtime_id=ANY($1::text[])", [[pastId, crossingId]]);
    await pool.query("DELETE FROM showtimes WHERE id=ANY($1::text[])", [[pastId, crossingId]]);
  }
});

test("UTC serialization and booking cutoff preserve confirmed bookings", async () => {
  const id = `cutoff-${tag}`;
  await pool.query(`INSERT INTO showtimes(id,movie_id,auditorium_id,starts_at,base_price,format)
    VALUES ($1,'afterlight',$2,'2026-11-14 00:45:00+05:30'::timestamptz,10,'STANDARD')`, [id, auditoriumId]);
  try {
    const { showtime } = await data(await fetch(`${base}/api/showtimes/${id}/seats`));
    assert.equal(showtime.startsAt, "2026-11-13T19:15:00.000Z");
    assert.equal(showtime.date, "2026-11-13");
    assert.equal(showtime.time, "7:15 PM");

    await pool.query("UPDATE showtimes SET starts_at=clock_timestamp()+interval '2 minutes' WHERE id=$1", [id]);
    const response = await post("/api/holds", { showtimeId: id, seatIds: [seats[2]] }, cookies[0]);
    assert.equal(response.status, 201);
    const created = await data(response);
    const available = await data(await fetch(`${base}/api/showtimes/${id}/availability`));
    assert.equal(created.expiresAt, available.startsAt);
    const confirmation = await post(`/api/holds/${created.id}/confirm`, {}, cookies[0]);
    assert.equal(confirmation.status, 200);
    const booked = await data(confirmation);

    await pool.query("UPDATE showtimes SET starts_at=statement_timestamp() WHERE id=$1", [id]);
    const late = await post("/api/holds", { showtimeId: id, seatIds: [seats[3]] }, cookies[0]);
    assert.equal(late.status, 409);
    assert.match((await late.json()).error, /already started/);
    const shows = await data(await fetch(`${base}/api/showtimes?movieId=afterlight`));
    assert.ok(!shows.some((show: { id: string }) => show.id === id));
    const retry = await post(`/api/holds/${created.id}/confirm`, {}, cookies[0]);
    assert.equal(retry.status, 200);
    assert.equal((await data(retry)).id, booked.id);
    assert.equal((await data(await fetch(`${base}/api/bookings/${booked.id}`, { headers: { Cookie: cookies[0] } }))).id, booked.id);
  } finally {
    for (const table of ["booking_seats", "seat_claims", "bookings", "seat_holds", "showtimes"]) {
      await pool.query(`DELETE FROM ${table} WHERE ${table === "showtimes" ? "id" : "showtime_id"}=$1`, [id]);
    }
  }
});
