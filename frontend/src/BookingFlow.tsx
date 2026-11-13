import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Clock3, X } from "lucide-react";
import type { AuthUser } from "./AccountPages";

type Showtime = { id: string; time: string; format: string; price: number; date: string };
type Movie = { id: string; title: string; genre: string; rating: string; runtime: string; synopsis: string; image: string };
type Seat = { id: string; rowLabel: string; seatNumber: number; label: string; status: "available" | "held" | "booked" };
type Hold = { id: string; showtimeId: string; status: string; expiresAt: string; seats: Seat[]; seatCount: number; unitPrice: number; total: number };
type Booking = { id: string; reference: string; movieTitle: string; startsAt: string; auditorium: string; seats: { label: string }[]; total: number; paymentStatus: string };
type Props = { movie: Movie; user: AuthUser | null; onClose: () => void; onLogin: () => void; onAccount: () => void };

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
  return payload.data as T;
}
const writeHeaders = { "Content-Type": "application/json", "X-SeatLock-Request": "1" };

export default function BookingFlow({ movie, user, onClose, onLogin, onAccount }: Props) {
  const [showtimes, setShowtimes] = useState<Showtime[]>([]);
  const [show, setShow] = useState<Showtime | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const activeShow = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/showtimes?movieId=${encodeURIComponent(movie.id)}`).then(readJson<Showtime[]>).then((items) => { if (active) setShowtimes(items); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load showtimes."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [movie.id]);
  async function refresh(showId: string) {
    try { const layout = await readJson<{ seats: Seat[] }>(await fetch(`/api/showtimes/${encodeURIComponent(showId)}/availability`)); if (activeShow.current === showId) setSeats(layout.seats); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not refresh seats."); }
  }
  useEffect(() => {
    if (!show || hold || booking) return;
    const timer = window.setInterval(() => { void refresh(show.id); }, 8000);
    return () => window.clearInterval(timer);
  }, [show?.id, hold?.id, booking?.id]);
  useEffect(() => {
    if (!hold) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(hold.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) { setHold(null); setSelected([]); setMessage("Your five-minute hold expired. Choose available seats again."); void refresh(hold.showtimeId); }
    };
    tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer);
  }, [hold?.id]);

  function chooseShowtime(item: Showtime) {
    activeShow.current = item.id;
    setShow(item); setSeats([]); setSelected([]); setHold(null); setBooking(null); setError(""); setMessage("");
    void refresh(item.id);
  }
  function toggleSeat(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 6 ? [...current, id] : current); }
  async function createHold() {
    if (!show || !selected.length) return;
    if (!user) { onLogin(); return; }
    setBusy(true); setError(""); setMessage("");
    try { const created = await readJson<Hold>(await fetch("/api/holds", { method: "POST", credentials: "same-origin", headers: writeHeaders, body: JSON.stringify({ showtimeId: show.id, seatIds: selected }) }));
      setHold(created); setSelected([]); await refresh(show.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not hold seats."); await refresh(show.id); }
    finally { setBusy(false); }
  }
  async function release(closeAfter = false) {
    if (!hold) { if (closeAfter) onClose(); return; }
    setBusy(true); setError("");
    try { const response = await fetch(`/api/holds/${hold.id}`, { method: "DELETE", credentials: "same-origin", headers: { "X-SeatLock-Request": "1" } });
      if (!response.ok) await readJson(response);
      setHold(null); setSelected([]); if (closeAfter) onClose(); else { setMessage("Seats released."); await refresh(hold.showtimeId); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not release seats."); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!hold) return;
    setBusy(true); setError("");
    try { const confirmed = await readJson<Booking>(await fetch(`/api/holds/${hold.id}/confirm`, { method: "POST", credentials: "same-origin", headers: writeHeaders, body: "{}" }));
      setBooking(confirmed); setHold(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not confirm booking."); await refresh(hold.showtimeId); }
    finally { setBusy(false); }
  }
  const selectedLabels = seats.filter((seat) => selected.includes(seat.id)).map((seat) => seat.label);
  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) void release(true); }}><section className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title">
    <button className="modal-close" aria-label="Close" onClick={() => void release(true)}><X size={19}/></button>
    <div className="modal-poster" style={{ backgroundImage: `linear-gradient(0deg, #151515, transparent 70%), url(${movie.image})` }}><span className="modal-tag">{movie.genre}</span></div>
    <div className="modal-body"><div className="modal-heading"><div><p className="film-genre">{movie.rating} · {movie.runtime}</p><h2 id="booking-title">{movie.title}</h2></div></div>
    <p className="modal-synopsis">{movie.synopsis}</p><div className="modal-divider"/>
    {booking ? <div className="booking-success"><span className="success-icon"><Check size={24}/></span><div className="modal-label">DEMO CONFIRMATION — NO PAYMENT CHARGED</div><h3>You're on the list.</h3><p>Reference <strong>{booking.reference}</strong></p><p>{booking.seats.map((seat) => seat.label).join(", ")} · {booking.auditorium} · ${booking.total.toFixed(2)}</p><button className="button button-primary" onClick={onAccount}>View your bookings <ArrowRight size={15}/></button></div> : <>
      <div className="modal-label">SHOWTIMES <span>{showtimes[0]?.date ?? ""}</span></div>
      {loading && <div className="modal-hint">Loading showtimes…</div>}
      {!loading && !error && !showtimes.length && <div className="modal-hint">No showtimes are available.</div>}
      <div className="showtime-list">{showtimes.map((item) => <button key={item.id} disabled={!!hold || busy} className={`showtime-chip ${show?.id === item.id ? "showtime-selected" : ""}`} onClick={() => chooseShowtime(item)}><b>{item.time}</b><small>{item.format} · ${item.price}</small></button>)}</div>
      {message && <p className="booking-message" role="status">{message}</p>}{error && <p className="form-error booking-error" role="alert">{error}</p>}
      {show && <div className="seat-picker"><div className="seat-picker-head"><div><div className="modal-label">CHOOSE YOUR SEATS</div><p>Up to 6 seats · {show.format}</p></div>{hold ? <span className="hold-timer"><Clock3 size={14}/>{clock}</span> : <span className="sample-badge">LIVE AVAILABILITY</span>}</div>
        {!seats.length && <div className="modal-hint">Loading seats…</div>}
        {seats.length > 0 && <><div className="screen-curve"><span>SCREEN</span></div><div className="seat-grid" aria-label="Seat selection">{[...new Set(seats.map((seat) => seat.rowLabel))].map((row) => <div className="seat-row" key={row}><span className="row-label">{row}</span>{seats.filter((seat) => seat.rowLabel === row).map((seat) => <button key={seat.id} aria-label={`Seat ${seat.label}, ${selected.includes(seat.id) ? "selected" : seat.status}`} disabled={!!hold || seat.status !== "available"} className={`seat ${selected.includes(seat.id) ? "seat-selected" : seat.status === "booked" ? "seat-booked" : seat.status === "held" ? "seat-occupied" : ""}`} onClick={() => toggleSeat(seat.id)}>{selected.includes(seat.id) ? <Check size={11}/> : null}</button>)}<span className="row-label">{row}</span></div>)}</div>
          <div className="seat-legend"><span><i className="legend-seat"/> Available</span><span><i className="legend-seat legend-selected"/> Selected</span><span><i className="legend-seat legend-taken"/> Held</span><span><i className="legend-seat legend-booked"/> Booked</span></div></>}
        {hold ? <><div className="seat-summary"><span>Held: {hold.seats.map((seat) => seat.label).join(", ")}</span><b>${hold.total.toFixed(2)}</b></div><p className="hold-note">Seats are held until {new Date(hold.expiresAt).toLocaleTimeString()}. No payment will be charged.</p><button className="button button-primary confirm-button" disabled={busy} onClick={() => void confirm()}>{busy ? "Please wait…" : "Demo Confirmation — No Payment Charged"} <ArrowRight size={15}/></button><button className="release-button" disabled={busy} onClick={() => void release()}>Release seats</button></> : <><div className="seat-summary"><span>{selectedLabels.length ? selectedLabels.join(", ") : "Select seats to continue"}</span><b>{selected.length ? `Est. $${(selected.length * show.price).toFixed(2)}` : "$0.00"}</b></div><button className="button button-primary confirm-button" disabled={!selected.length || busy} onClick={() => void createHold()}>{busy ? "Checking seats…" : user ? "Hold seats for 5 minutes" : "Log in to hold seats"} <ArrowRight size={15}/></button></>}
        <p className="demo-disclaimer">Availability refreshes every 8 seconds. A hold or booking is final only when the server confirms it.</p>
      </div>}
    </>}
    </div></section></div>;
}
