import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Clock3, X } from "lucide-react";
import { io } from "socket.io-client";
import type { AuthUser } from "./AccountPages";

type Showtime = { id: string; time: string; format: string; price: number; date: string };
type Movie = { id: string; title: string; genre: string; rating: string; runtime: string; synopsis: string; image: string };
type Seat = { id: string; rowLabel: string; seatNumber: number; label: string; status: "available" | "held" | "booked" };
type Hold = { id: string; showtimeId: string; status: string; expiresAt: string; serverTime: string; seats: Seat[]; seatCount: number; unitPrice: number; total: number };
type AvailabilityNotice = { showtimeId: string; reason: "hold_created" | "hold_released" | "booking_confirmed"; changedAt: string };
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
  const [showtimesRetry, setShowtimesRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [liveState, setLiveState] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const activeShow = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const clockOffset = useRef(0);
  const restored = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const savedHoldKey = "seatlock.activeHold";
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); void release(true); }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hold?.id, busy]);

  useEffect(() => {
    let active = true;
    fetch(`/api/showtimes?movieId=${encodeURIComponent(movie.id)}`).then(readJson<Showtime[]>).then((items) => { if (active) setShowtimes(items); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load showtimes."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [movie.id, showtimesRetry]);
  async function refresh(showId: string) {
    const request = ++requestSequence.current;
    try { const layout = await readJson<{ seats: Seat[] }>(await fetch(`/api/showtimes/${encodeURIComponent(showId)}/availability`));
      if (activeShow.current === showId && requestSequence.current === request) { setSeats(layout.seats); setError(""); } }
    catch (cause) { if (activeShow.current === showId && requestSequence.current === request) setError(cause instanceof Error ? cause.message : "Could not refresh seats."); }
  }
  useEffect(() => {
    if (!show || booking) return;
    const timer = window.setInterval(() => { void refresh(show.id); }, 8000);
    return () => window.clearInterval(timer);
  }, [show?.id, hold?.id, booking?.id]);
  useEffect(() => {
    if (!show) return;
    const showId = show.id;
    const socket = io({ path: "/socket.io", transports: ["websocket"], withCredentials: true, reconnection: true });
    const onConnect = () => { setLiveState("live"); socket.emit("showtime:join", showId, (reply: { ok: boolean }) => { if (!reply?.ok) setLiveState("reconnecting"); void refresh(showId); }); void refresh(showId); };
    const onDisconnect = () => setLiveState("reconnecting");
    const onNotice = (notice: AvailabilityNotice) => { if (notice.showtimeId === showId) void refresh(showId); };
    socket.on("connect", onConnect); socket.on("disconnect", onDisconnect); socket.on("connect_error", onDisconnect);
    socket.on("availability:changed", onNotice);
    if (socket.connected) onConnect();
    return () => { socket.emit("showtime:leave", showId); socket.off("connect", onConnect); socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onDisconnect); socket.off("availability:changed", onNotice); socket.disconnect(); };
  }, [show?.id]);
  useEffect(() => {
    if (!user || !showtimes.length || restored.current) return;
    restored.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(savedHoldKey) ?? "null") as { movieId?: string; showtimeId?: string; holdId?: string } | null;
      if (!saved || saved.movieId !== movie.id || !saved.holdId) return;
      const item = showtimes.find((candidate) => candidate.id === saved.showtimeId);
      if (!item) { sessionStorage.removeItem(savedHoldKey); return; }
      activeShow.current = item.id; setShow(item); void refresh(item.id);
      fetch(`/api/holds/${saved.holdId}`, { credentials: "same-origin" }).then(readJson<Hold>).then((current) => {
        if (current.status === "active") { clockOffset.current = new Date(current.serverTime).getTime() - Date.now(); setHold(current); setMessage("Your reservation was restored."); }
        else { sessionStorage.removeItem(savedHoldKey); setMessage("Your previous hold is no longer active. Choose seats again."); }
      }).catch(() => { sessionStorage.removeItem(savedHoldKey); setMessage("Your previous hold could not be restored. Choose seats again."); });
    } catch { sessionStorage.removeItem(savedHoldKey); }
  }, [showtimes, user?.id, movie.id]);
  useEffect(() => {
    if (!hold) return;
    const holdId = hold.id; const showId = hold.showtimeId;
    const timer = window.setInterval(() => {
      fetch(`/api/holds/${holdId}`, { credentials: "same-origin" }).then(readJson<Hold>).then((current) => {
        if (current.status !== "active") { sessionStorage.removeItem(savedHoldKey); setHold(null); setSelected([]); setMessage("Your hold is no longer active. Choose available seats again."); void refresh(showId); }
        else { clockOffset.current = new Date(current.serverTime).getTime() - Date.now(); setHold(current); }
      }).catch(() => setError("Could not verify your hold. We will retry; confirmation is checked by the server."));
    }, 10000);
    return () => window.clearInterval(timer);
  }, [hold?.id]);
  useEffect(() => {
    if (!hold) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(hold.expiresAt).getTime() - (Date.now() + clockOffset.current)) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) { sessionStorage.removeItem(savedHoldKey); setHold(null); setSelected([]); setMessage("Your five-minute hold expired. Choose available seats again."); void refresh(hold.showtimeId); }
    };
    tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer);
  }, [hold?.id]);

  function chooseShowtime(item: Showtime) {
    activeShow.current = item.id;
    requestSequence.current++;
    setShow(item); setSeats([]); setSelected([]); setHold(null); setBooking(null); setError(""); setMessage("");
    void refresh(item.id);
  }
  function toggleSeat(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 6 ? [...current, id] : current); }
  async function createHold() {
    if (!show || !selected.length) return;
    if (!user) { onLogin(); return; }
    setBusy(true); setError(""); setMessage("");
    try { const created = await readJson<Hold>(await fetch("/api/holds", { method: "POST", credentials: "same-origin", headers: writeHeaders, body: JSON.stringify({ showtimeId: show.id, seatIds: selected }) }));
      clockOffset.current = new Date(created.serverTime).getTime() - Date.now();
      sessionStorage.setItem(savedHoldKey, JSON.stringify({ movieId: movie.id, showtimeId: show.id, holdId: created.id }));
      setHold(created); setSelected([]); await refresh(show.id); }
    catch (cause) { await refresh(show.id); setError(cause instanceof Error ? cause.message : "Could not hold seats."); }
    finally { setBusy(false); }
  }
  async function release(closeAfter = false) {
    if (!hold) { if (closeAfter) onClose(); return; }
    setBusy(true); setError("");
    try { const response = await fetch(`/api/holds/${hold.id}`, { method: "DELETE", credentials: "same-origin", headers: { "X-SeatLock-Request": "1" } });
      if (!response.ok) await readJson(response);
      sessionStorage.removeItem(savedHoldKey); setHold(null); setSelected([]); if (closeAfter) onClose(); else { setMessage("Seats released."); await refresh(hold.showtimeId); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not release seats."); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!hold || secondsLeft <= 0) return;
    setBusy(true); setError("");
    try { const current = await readJson<Hold>(await fetch(`/api/holds/${hold.id}`, { credentials: "same-origin" }));
      if (current.status !== "active") { sessionStorage.removeItem(savedHoldKey); setHold(null); setMessage("Your hold expired. Choose available seats again."); await refresh(hold.showtimeId); return; }
      clockOffset.current = new Date(current.serverTime).getTime() - Date.now();
      const confirmed = await readJson<Booking>(await fetch(`/api/holds/${hold.id}/confirm`, { method: "POST", credentials: "same-origin", headers: writeHeaders, body: "{}" }));
      sessionStorage.removeItem(savedHoldKey); setBooking(confirmed); setHold(null); }
    catch (cause) { await refresh(hold.showtimeId); setError(cause instanceof Error ? cause.message : "Could not confirm booking."); }
    finally { setBusy(false); }
  }
  const selectedLabels = seats.filter((seat) => selected.includes(seat.id)).map((seat) => seat.label);
  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) void release(true); }}><section ref={dialogRef} tabIndex={-1} className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title">
    <button className="modal-close" aria-label="Close" disabled={busy} onClick={() => void release(true)}><X size={19}/></button>
    <div className="modal-poster" style={{ backgroundImage: `linear-gradient(0deg, #151515, transparent 70%), url(${movie.image})` }}><span className="modal-tag">{movie.genre}</span></div>
    <div className="modal-body"><div className="modal-heading"><div><p className="film-genre">{movie.rating} · {movie.runtime}</p><h2 id="booking-title">{movie.title}</h2></div></div>
    <p className="modal-synopsis">{movie.synopsis}</p><div className="modal-divider"/>
    {booking ? <div className="booking-success"><span className="success-icon"><Check size={24}/></span><div className="modal-label">DEMO CONFIRMATION — NO PAYMENT CHARGED</div><h3>You're on the list.</h3><p>Reference <strong>{booking.reference}</strong></p><p>{booking.seats.map((seat) => seat.label).join(", ")} · {booking.auditorium} · ${booking.total.toFixed(2)}</p><button className="button button-primary" onClick={onAccount}>View your bookings <ArrowRight size={15}/></button></div> : <>
      <div className="modal-label">SHOWTIMES <span>{showtimes[0]?.date ?? ""}</span></div>
      {loading && <div className="modal-hint">Loading showtimes…</div>}
      {error && !show && <button className="retry-button" onClick={() => { setError(""); setLoading(true); setShowtimesRetry((value) => value + 1); }}>Retry showtimes</button>}
      {!loading && !error && !showtimes.length && <div className="modal-hint">No showtimes are available.</div>}
      <div className="showtime-list">{showtimes.map((item) => <button key={item.id} disabled={!!hold || busy} className={`showtime-chip ${show?.id === item.id ? "showtime-selected" : ""}`} onClick={() => chooseShowtime(item)}><b>{item.time}</b><small>{item.format} · ${item.price}</small></button>)}</div>
      {message && <p className="booking-message" role="status">{message}</p>}{error && <p className="form-error booking-error" role="alert">{error}</p>}{error && show && <button className="retry-button" onClick={() => { setError(""); void refresh(show.id); }}>Retry availability</button>}
      {show && <div className="seat-picker"><div className="seat-picker-head"><div><div className="modal-label">CHOOSE YOUR SEATS</div><p>Up to 6 seats · {show.format}</p></div>{hold ? <span className="hold-timer" role="timer" aria-label={`${clock} remaining on your hold`} aria-live="off"><Clock3 size={14}/>{clock}</span> : <span className="sample-badge" role="status">{liveState === "live" ? "LIVE AVAILABILITY" : "RECONNECTING · POLLING BACKUP"}</span>}</div>
        {!seats.length && <div className="modal-hint">Loading seats…</div>}
        {seats.length > 0 && <><div className="screen-curve"><span>SCREEN</span></div><div className="seat-grid" aria-label="Seat selection">{[...new Set(seats.map((seat) => seat.rowLabel))].map((row) => <div className="seat-row" key={row}><span className="row-label">{row}</span>{seats.filter((seat) => seat.rowLabel === row).map((seat) => <button key={seat.id} aria-label={`Seat ${seat.label}, ${selected.includes(seat.id) ? "selected" : seat.status}`} disabled={!!hold || seat.status !== "available"} className={`seat ${selected.includes(seat.id) ? "seat-selected" : seat.status === "booked" ? "seat-booked" : seat.status === "held" ? "seat-occupied" : ""}`} onClick={() => toggleSeat(seat.id)}>{selected.includes(seat.id) ? <Check size={11}/> : null}</button>)}<span className="row-label">{row}</span></div>)}</div>
          <div className="seat-legend"><span><i className="legend-seat"/> Available</span><span><i className="legend-seat legend-selected"/> Selected</span><span><i className="legend-seat legend-taken"/> Held</span><span><i className="legend-seat legend-booked"/> Booked</span></div></>}
        {hold ? <><div className="seat-summary"><span>Held: {hold.seats.map((seat) => seat.label).join(", ")}</span><b>${hold.total.toFixed(2)}</b></div><p className="hold-note">Seats are held until {new Date(hold.expiresAt).toLocaleTimeString()}. No payment will be charged.</p><button className="button button-primary confirm-button" disabled={busy || secondsLeft <= 0} onClick={() => void confirm()}>{busy ? "Please wait…" : "Demo Confirmation — No Payment Charged"} <ArrowRight size={15}/></button><button className="release-button" disabled={busy} onClick={() => void release()}>Release seats</button></> : <><div className="seat-summary"><span>{selectedLabels.length ? selectedLabels.join(", ") : "Select seats to continue"}</span><b>{selected.length ? `Est. $${(selected.length * show.price).toFixed(2)}` : "$0.00"}</b></div><button className="button button-primary confirm-button" disabled={!selected.length || busy} onClick={() => void createHold()}>{busy ? "Checking seats…" : user ? "Hold seats for 5 minutes" : "Log in to hold seats"} <ArrowRight size={15}/></button></>}
        <p className="demo-disclaimer">Availability refreshes every 8 seconds. A hold or booking is final only when the server confirms it.</p>
      </div>}
    </>}
    </div></section></div>;
}
