import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { query } from "./db.js";
import { frontendOrigin } from "./config.js";

export type AvailabilityReason = "hold_created" | "hold_released" | "booking_confirmed";
export type AvailabilityNotice = { showtimeId: string; reason: AvailabilityReason; changedAt: string };
type JoinReply = (result: { ok: boolean; error?: string }) => void;
let activeServer: Server | null = null;
const room = (showtimeId: string) => `showtime:${showtimeId}`;
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

export function attachRealtime(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: frontendOrigin, credentials: true },
    allowRequest: (request, done) => done(null, request.headers.origin === frontendOrigin),
    serveClient: false
  });
  activeServer = io;
  io.on("connection", (socket) => {
    socket.on("showtime:join", async (value: unknown, reply?: JoinReply) => {
      if (!validId(value)) { reply?.({ ok: false, error: "Invalid showtime" }); return; }
      try {
        const found = await query("SELECT 1 FROM showtimes WHERE id=$1", [value]);
        if (!found.rowCount) { reply?.({ ok: false, error: "Showtime not found" }); return; }
        await socket.join(room(value));
        reply?.({ ok: true });
      } catch { reply?.({ ok: false, error: "Could not join showtime" }); }
    });
    socket.on("showtime:leave", (value: unknown) => { if (validId(value)) void socket.leave(room(value)); });
  });
  return io;
}

export function publishAvailability(showtimeId: string, reason: AvailabilityReason) {
  const notice: AvailabilityNotice = { showtimeId, reason, changedAt: new Date().toISOString() };
  activeServer?.to(room(showtimeId)).emit("availability:changed", notice);
}

export async function closeRealtime(io: Server) {
  if (activeServer === io) activeServer = null;
  await new Promise<void>((resolve) => io.close(() => resolve()));
}
