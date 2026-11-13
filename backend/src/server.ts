import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { findMovie, listMovies, listShowtimes, showtimeSeats } from "./repository.js";

export const app = express();
const port = Number(process.env.PORT) || 4000;
app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json());

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
app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("API error", error);
  return res.status(503).json({ error: "Database unavailable. Please try again later." });
});

if (process.argv[1]?.endsWith("server.js")) app.listen(port, () => console.log(`SeatLock API listening on http://localhost:${port}`));
