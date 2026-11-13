import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { findMovie, listMovies, listShowtimes, showtimeSeats } from "./repository.js";
import { authRouter } from "./auth/routes.js";
import { requireSameOrigin } from "./auth/csrf.js";
import { bookingRouter } from "./booking/routes.js";
import { BookingError } from "./booking/service.js";
import { createServer } from "node:http";
import { attachRealtime, closeRealtime } from "./realtime.js";

export const app = express();
const port = Number(process.env.PORT) || 4000;
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173", credentials: true }));
app.use(express.json({ limit: "16kb" }));
app.use("/api/auth", (req, res, next) => req.method === "POST" ? requireSameOrigin(req, res, next) : next(), authRouter);

app.get("/api/health", async (_req, res, next) => {
  try { await pool.query("SELECT 1"); res.json({ status: "ok", database: "connected", service: "seatlock-api", timestamp: new Date().toISOString() }); }
  catch (error) { next(error); }
});
app.get("/api/movies", async (_req, res, next) => {
  try { res.json({ data: await listMovies(), source: "postgresql" }); } catch (error) { next(error); }
});
app.get("/api/movies/:id", async (req, res, next) => {
  try { const movie = await findMovie(String(req.params.id)); if (!movie) return res.status(404).json({ error: "Movie not found" }); return res.json({ data: movie, source: "postgresql" }); }
  catch (error) { return next(error); }
});
app.get("/api/showtimes", async (req, res, next) => {
  try { const movieId = typeof req.query.movieId === "string" ? req.query.movieId : "";
    if (!movieId) return res.status(400).json({ error: "movieId is required" });
    if (!await findMovie(movieId)) return res.status(404).json({ error: "Movie not found" });
    return res.json({ data: await listShowtimes(movieId), movieId, source: "postgresql" }); }
  catch (error) { return next(error); }
});
app.get("/api/showtimes/:id/seats", async (req, res, next) => {
  try { const layout = await showtimeSeats(String(req.params.id)); if (!layout) return res.status(404).json({ error: "Showtime not found" });
    return res.json({ data: layout, source: "postgresql" }); }
  catch (error) { return next(error); }
});
app.use("/api", bookingRouter);
app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof BookingError) return res.status(error.status).json({ error: error.message });
  console.error("API error", error);
  const code = (error as { code?: string } | null)?.code;
  if (code === "40P01" || code === "40001" || code === "23505") return res.status(409).json({ error: "Booking contention. Please retry." });
  const unavailable = code?.startsWith("08") || code === "ECONNREFUSED" || code === "ETIMEDOUT";
  return res.status(unavailable ? 503 : 500).json({ error: unavailable ? "Database unavailable. Please try again later." : "Something went wrong." });
});

if (process.argv[1]?.endsWith("server.js")) {
  const httpServer = createServer(app);
  const io = attachRealtime(httpServer);
  httpServer.listen(port, () => console.log(`SeatLock API listening on http://localhost:${port}`));
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await closeRealtime(io);
      if (httpServer.listening) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await pool.end();
      console.log("SeatLock API stopped");
    } catch (error) { console.error("Shutdown error", error); process.exitCode = 1; }
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
}
