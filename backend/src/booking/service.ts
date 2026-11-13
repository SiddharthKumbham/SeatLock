import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, query } from "../db.js";

export class BookingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await run(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
type ShowRow = { id: string; auditorium_id: string; base_price: string };
type HoldRow = { id: string; user_id: string; showtime_id: string; auditorium_id: string; seat_count: number; unit_price: string; status: string; expires_at: Date; effective_status: string };
type SeatRow = { id: string; row_label: string; seat_number: number; status?: string };
type BookingRow = { id: string; reference: string; showtime_id: string; movie_title: string; starts_at: Date; auditorium_name: string; total_price: string; confirmed_at: Date };
const mapSeat = (seat: SeatRow) => ({ id: seat.id, rowLabel: seat.row_label, seatNumber: seat.seat_number, label: `${seat.row_label}${seat.seat_number}`, ...(seat.status ? { status: seat.status } : {}) });

export async function availability(showtimeId: string) {
  const show = await query<ShowRow>("SELECT id,auditorium_id,base_price FROM showtimes WHERE id=$1", [showtimeId]);
  if (!show.rows[0]) throw new BookingError(404, "Showtime not found");
  const seats = await query<SeatRow>(`SELECT s.id,s.row_label,s.seat_number,
    CASE WHEN c.state='booked' THEN 'booked' WHEN c.state='held' AND c.expires_at > clock_timestamp() THEN 'held' ELSE 'available' END AS status
    FROM seats s LEFT JOIN seat_claims c ON c.showtime_id=$1 AND c.seat_id=s.id
    WHERE s.auditorium_id=$2 ORDER BY s.row_label,s.seat_number`, [showtimeId, show.rows[0].auditorium_id]);
  return { showtimeId, seats: seats.rows.map(mapSeat) };
}

export async function createHold(userId: string, showtimeId: string, seatIds: string[]) {
  const sorted = [...seatIds].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
  const id = randomUUID();
  await transaction(async (client) => {
    const show = await client.query<ShowRow>("SELECT id,auditorium_id,base_price FROM showtimes WHERE id=$1", [showtimeId]);
    if (!show.rows[0]) throw new BookingError(404, "Showtime not found");
    const auditoriumId = show.rows[0].auditorium_id;
    const valid = await client.query<SeatRow>("SELECT id FROM seats WHERE auditorium_id=$1 AND id=ANY($2::bigint[])", [auditoriumId, sorted]);
    if (valid.rows.length !== sorted.length) throw new BookingError(400, "One or more seats are invalid for this showtime");
    const hold = await client.query<{ expires_at: Date }>(`INSERT INTO seat_holds(id,user_id,showtime_id,auditorium_id,seat_count,unit_price,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp() + interval '5 minutes') RETURNING expires_at`,
      [id, userId, showtimeId, auditoriumId, sorted.length, show.rows[0].base_price]);
    for (const seatId of sorted) {
      const claim = await client.query(`INSERT INTO seat_claims(showtime_id,auditorium_id,seat_id,state,hold_id,expires_at)
        VALUES ($1,$2,$3,'held',$4,$5)
        ON CONFLICT (showtime_id,seat_id) DO UPDATE SET state='held',hold_id=EXCLUDED.hold_id,booking_id=NULL,expires_at=EXCLUDED.expires_at
        WHERE seat_claims.state='held' AND seat_claims.expires_at <= clock_timestamp() RETURNING seat_id`,
        [showtimeId, auditoriumId, seatId, id, hold.rows[0].expires_at]);
      if (!claim.rowCount) throw new BookingError(409, "One or more seats are no longer available");
    }
  });
  const result = await holdDetails(userId, id);
  if (!result) throw new Error("Created hold could not be read");
  return result;
}

export async function holdDetails(userId: string, holdId: string) {
  const result = await query<HoldRow>(`SELECT *,CASE WHEN status='active' AND expires_at <= clock_timestamp() THEN 'expired' ELSE status END AS effective_status
    FROM seat_holds WHERE id=$1 AND user_id=$2`, [holdId, userId]);
  const hold = result.rows[0];
  if (!hold) return null;
  const seats = await query<SeatRow>(`SELECT s.id,s.row_label,s.seat_number FROM seat_claims c JOIN seats s ON s.id=c.seat_id
    WHERE c.hold_id=$1 AND c.state='held' ORDER BY s.row_label,s.seat_number`, [holdId]);
  return { id: hold.id, showtimeId: hold.showtime_id, status: hold.effective_status, expiresAt: hold.expires_at.toISOString(),
    seats: seats.rows.map(mapSeat), seatCount: hold.seat_count, unitPrice: Number(hold.unit_price), total: Math.round(Number(hold.unit_price) * 100) * hold.seat_count / 100 };
}

export async function releaseHold(userId: string, holdId: string) {
  await transaction(async (client) => {
    const result = await client.query<HoldRow>("SELECT * FROM seat_holds WHERE id=$1 AND user_id=$2 FOR UPDATE", [holdId, userId]);
    const hold = result.rows[0];
    if (!hold) throw new BookingError(404, "Hold not found");
    if (hold.status === "confirmed") throw new BookingError(409, "Confirmed bookings cannot be released");
    await client.query("DELETE FROM seat_claims WHERE hold_id=$1 AND state='held'", [holdId]);
    await client.query("UPDATE seat_holds SET status='released' WHERE id=$1", [holdId]);
  });
}

export async function confirmHold(userId: string, holdId: string) {
  const bookingId = await transaction(async (client) => {
    const result = await client.query<HoldRow>(`SELECT *,CASE WHEN expires_at <= clock_timestamp() THEN 'expired' ELSE status END AS effective_status
      FROM seat_holds WHERE id=$1 AND user_id=$2 FOR UPDATE`, [holdId, userId]);
    const hold = result.rows[0];
    if (!hold) throw new BookingError(404, "Hold not found");
    if (hold.status === "confirmed") {
      const existing = await client.query<{ id: string }>("SELECT id FROM bookings WHERE hold_id=$1", [holdId]);
      if (!existing.rows[0]) throw new Error("Confirmed hold has no booking");
      return existing.rows[0].id;
    }
    if (hold.status === "released") throw new BookingError(409, "Hold was released");
    if (hold.effective_status === "expired") throw new BookingError(410, "Hold has expired");
    const claims = await client.query<{ seat_id: string }>(`SELECT seat_id FROM seat_claims WHERE hold_id=$1 AND state='held' ORDER BY seat_id FOR UPDATE`, [holdId]);
    if (claims.rows.length !== hold.seat_count) throw new BookingError(409, "Held seats are no longer available");
    const id = randomUUID();
    const reference = `SL-${randomBytes(8).toString("hex").toUpperCase()}`;
    await client.query(`INSERT INTO bookings(id,reference,hold_id,user_id,showtime_id,auditorium_id,total_price)
      VALUES ($1,$2,$3,$4,$5,$6,$7::numeric * $8)`, [id, reference, holdId, userId, hold.showtime_id, hold.auditorium_id, hold.unit_price, hold.seat_count]);
    await client.query(`INSERT INTO booking_seats(booking_id,showtime_id,auditorium_id,seat_id,price_paid)
      SELECT $1,showtime_id,auditorium_id,seat_id,$2 FROM seat_claims WHERE hold_id=$3 AND state='held'`, [id, hold.unit_price, holdId]);
    const updated = await client.query(`UPDATE seat_claims SET state='booked',hold_id=NULL,booking_id=$1,expires_at=NULL
      WHERE hold_id=$2 AND state='held'`, [id, holdId]);
    if (updated.rowCount !== hold.seat_count) throw new Error("Booking claim count changed");
    await client.query("UPDATE seat_holds SET status='confirmed' WHERE id=$1", [holdId]);
    return id;
  });
  const booking = await bookingDetails(userId, bookingId);
  if (!booking) throw new Error("Confirmed booking could not be read");
  return booking;
}

export async function bookingDetails(userId: string, bookingId: string) {
  const result = await query<BookingRow>(`SELECT b.id,b.reference,b.showtime_id,m.title AS movie_title,sh.starts_at,a.name AS auditorium_name,b.total_price,b.confirmed_at
    FROM bookings b JOIN showtimes sh ON sh.id=b.showtime_id JOIN movies m ON m.id=sh.movie_id JOIN auditoriums a ON a.id=b.auditorium_id
    WHERE b.id=$1 AND b.user_id=$2`, [bookingId, userId]);
  const booking = result.rows[0];
  if (!booking) return null;
  const seats = await query<SeatRow & { price_paid: string }>(`SELECT s.id,s.row_label,s.seat_number,bs.price_paid FROM booking_seats bs
    JOIN seats s ON s.id=bs.seat_id WHERE bs.booking_id=$1 ORDER BY s.row_label,s.seat_number`, [bookingId]);
  return { id: booking.id, reference: booking.reference, showtimeId: booking.showtime_id, movieTitle: booking.movie_title,
    startsAt: booking.starts_at.toISOString(), auditorium: booking.auditorium_name, total: Number(booking.total_price),
    confirmedAt: booking.confirmed_at.toISOString(), seats: seats.rows.map((seat) => ({ ...mapSeat(seat), pricePaid: Number(seat.price_paid) })),
    paymentStatus: "No payment charged — demo confirmation" };
}
export async function bookingHistory(userId: string) {
  const result = await query<{ id: string }>("SELECT id FROM bookings WHERE user_id=$1 ORDER BY confirmed_at DESC", [userId]);
  return Promise.all(result.rows.map((row) => bookingDetails(userId, row.id)));
}
