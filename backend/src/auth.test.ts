import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { app } from "./server.js";
import { pool } from "./db.js";

const email = `seatlock-test-${randomUUID()}@example.test`;
const password = `Test-only-${randomUUID()}!`;
const origin = process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";
let server: Server;
let base: string;
let registrationCookie = "";
let loginCookie = "";

before(async () => {
  await pool.query("SELECT 1"); server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await pool.query("DELETE FROM users WHERE email=$1", [email]);
  await new Promise<void>((resolve) => server.close(() => resolve())); await pool.end();
});
function post(path: string, body?: object, cookie?: string) {
  return fetch(`${base}/api/auth/${path}`, { method: "POST", headers: { Origin: origin, "X-SeatLock-Request": "1", "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body ?? {}) });
}
const cookieOf = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] ?? "";

test("unauthorized profile, validation, and CSRF protection", async () => {
  assert.equal((await fetch(`${base}/api/auth/me`)).status, 401);
  assert.equal((await post("register", { name: "A", email: "bad", password: "short" })).status, 400);
  assert.equal((await post("login", { email: "bad", password: "x" })).status, 400);
  assert.equal((await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
});
test("registration stores Argon2id hash and creates HTTP-only session", async () => {
  const response = await post("register", { name: "Test Person", email, password });
  assert.equal(response.status, 201);
  const payload = await response.json(); assert.equal(payload.user.email, email); assert.equal(payload.user.password_hash, undefined);
  registrationCookie = cookieOf(response);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
  assert.match(response.headers.get("set-cookie") ?? "", /SameSite=Lax/i);
  const stored = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email=$1", [email]);
  assert.match(stored.rows[0].password_hash, /^\$argon2id\$/); assert.notEqual(stored.rows[0].password_hash, password);
});
test("duplicate email is 409 and profile survives repeated requests", async () => {
  assert.equal((await post("register", { name: "Other Person", email: email.toUpperCase(), password })).status, 409);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/api/auth/me`, { headers: { Cookie: registrationCookie } });
    assert.equal(response.status, 200); assert.equal((await response.json()).user.email, email);
  }
});
test("session survives an API server restart", async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server");
  base = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: registrationCookie } })).status, 200);
});
test("login rejects wrong credentials and rotates session", async () => {
  const wrong = await post("login", { email, password: "incorrect-password" });
  const absent = await post("login", { email: "missing@example.test", password });
  assert.equal(wrong.status, 401); assert.equal(absent.status, 401);
  assert.equal((await wrong.json()).error, (await absent.json()).error);
  const response = await post("login", { email, password }, registrationCookie);
  assert.equal(response.status, 200); loginCookie = cookieOf(response); assert.notEqual(loginCookie, registrationCookie);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: registrationCookie } })).status, 401);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: loginCookie } })).status, 200);
});
test("production cookies include Secure", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const response = await post("login", { email, password }, loginCookie);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie") ?? "", /Secure/i);
    loginCookie = cookieOf(response);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
test("logout invalidates session and public APIs remain available", async () => {
  assert.equal((await post("logout", {}, loginCookie)).status, 204);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: loginCookie } })).status, 401);
  assert.equal((await fetch(`${base}/api/movies`)).status, 200);
  assert.equal((await fetch(`${base}/api/showtimes?movieId=afterlight`)).status, 200);
  assert.equal((await fetch(`${base}/api/showtimes/a1/seats`)).status, 200);
});
test("login rate limit rejects excessive attempts", async () => {
  let status = 0;
  for (let i = 0; i < 11; i++) status = (await post("login", { email: "missing@example.test", password })).status;
  assert.equal(status, 429);
});
test("registration rate limit bounds password hashing requests", async () => {
  let status = 0;
  for (let i = 0; i < 3; i++) status = (await post("register", { name: "A", email: "bad", password: "short" })).status;
  assert.equal(status, 429);
});
