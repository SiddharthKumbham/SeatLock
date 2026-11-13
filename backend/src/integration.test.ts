import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { app } from "./server.js";
import { pool } from "./db.js";

let server: Server;
let base: string;
before(async () => {
  await pool.query("SELECT 1");
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await pool.end(); });

test("health checks PostgreSQL", async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).database, "connected");
});
test("catalog and movie details return seeded rows", async () => {
  const catalog = await (await fetch(`${base}/api/movies`)).json();
  assert.equal(catalog.data.length, 4);
  assert.equal(catalog.source, "postgresql");
  const detail = await (await fetch(`${base}/api/movies/afterlight`)).json();
  assert.equal(detail.data.showtimes.length, 4);
});
test("showtimes and physical seats are joined to their movie and auditorium", async () => {
  const shows = await (await fetch(`${base}/api/showtimes?movieId=afterlight`)).json();
  assert.equal(shows.data.length, 4);
  const seats = await (await fetch(`${base}/api/showtimes/${shows.data[0].id}/seats`)).json();
  assert.equal(seats.data.seats.length, 40);
  assert.equal(seats.data.seats[0].label, "A1");
});
test("unknown records return 404 and missing movieId returns 400", async () => {
  assert.equal((await fetch(`${base}/api/movies/unknown`)).status, 404);
  assert.equal((await fetch(`${base}/api/showtimes?movieId=unknown`)).status, 404);
  assert.equal((await fetch(`${base}/api/showtimes/unknown/seats`)).status, 404);
  assert.equal((await fetch(`${base}/api/showtimes`)).status, 400);
});
