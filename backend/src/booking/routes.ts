import { Router } from "express";
import { requireAuth, type AuthUser } from "../auth/sessions.js";
import { requireSameOrigin } from "../auth/csrf.js";
import { availability, bookingDetails, bookingHistory, confirmHold, createHold, holdDetails, releaseHold } from "./service.js";

export const bookingRouter = Router();
const userId = (locals: Record<string, unknown>) => (locals.user as AuthUser).id;
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const seatId = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;

bookingRouter.get("/showtimes/:id/availability", async (req, res) => {
  res.set("Cache-Control", "no-store").json({ data: await availability(String(req.params.id)) });
});
bookingRouter.use("/holds", requireAuth);
bookingRouter.post("/holds", requireSameOrigin, async (req, res) => {
  const input = req.body as { showtimeId?: unknown; seatIds?: unknown } | null;
  if (!input || typeof input.showtimeId !== "string" || !input.showtimeId || input.showtimeId.length > 128 ||
      !Array.isArray(input.seatIds) || input.seatIds.length < 1 || input.seatIds.length > 6 ||
      !input.seatIds.every(seatId) || new Set(input.seatIds).size !== input.seatIds.length) {
    res.status(400).json({ error: "Provide a showtime and 1 to 6 unique seat IDs" }); return;
  }
  const hold = await createHold(userId(res.locals), input.showtimeId, input.seatIds);
  res.status(201).json({ data: hold });
});
bookingRouter.get("/holds/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!uuid(id)) { res.status(400).json({ error: "Invalid hold ID" }); return; }
  const hold = await holdDetails(userId(res.locals), id);
  if (!hold) { res.status(404).json({ error: "Hold not found" }); return; }
  res.json({ data: hold });
});
bookingRouter.delete("/holds/:id", requireSameOrigin, async (req, res) => {
  const id = String(req.params.id);
  if (!uuid(id)) { res.status(400).json({ error: "Invalid hold ID" }); return; }
  await releaseHold(userId(res.locals), id);
  res.status(204).end();
});
bookingRouter.post("/holds/:id/confirm", requireSameOrigin, async (req, res) => {
  const id = String(req.params.id);
  if (!uuid(id)) { res.status(400).json({ error: "Invalid hold ID" }); return; }
  res.json({ data: await confirmHold(userId(res.locals), id) });
});
bookingRouter.get("/bookings", requireAuth, async (_req, res) => {
  res.json({ data: await bookingHistory(userId(res.locals)) });
});
bookingRouter.get("/bookings/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  if (!uuid(id)) { res.status(400).json({ error: "Invalid booking ID" }); return; }
  const booking = await bookingDetails(userId(res.locals), id);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  res.json({ data: booking });
});
