import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CalendarDays, LockKeyhole, LogOut, Mail, UserRound } from "lucide-react";

export type AuthUser = { id: string; name: string; email: string; createdAt: string };
type Booking = { id: string; reference: string; movieTitle: string; startsAt: string; auditorium: string; seats: { label: string; pricePaid: number }[]; total: number; paymentStatus: string };
type Props = { route: string; user: AuthUser | null; onUser: (user: AuthUser | null) => void; navigate: (path: string) => void };

async function authRequest(path: string, body?: object): Promise<{ user: AuthUser | null }> {
  const response = await fetch(`/api/auth/${path}`, { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-SeatLock-Request": "1" }, body: body ? JSON.stringify(body) : undefined });
  if (response.status === 204) return { user: null };
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Something went wrong. Please try again.");
  return payload;
}

export default function AccountPages({ route, user, onUser, navigate }: Props) {
  const isSignup = route === "/signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(route === "/account");
  const [bookingsError, setBookingsError] = useState("");
  const [bookingsRetry, setBookingsRetry] = useState(0);
  useEffect(() => {
    if (route !== "/account" || !user) return;
    let active = true;
    fetch("/api/bookings", { credentials: "same-origin" }).then(async (response) => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Could not load bookings."); return payload.data as Booking[];
    }).then((items) => { if (active) setBookings(items); })
      .catch((cause) => { if (active) setBookingsError(cause instanceof Error ? cause.message : "Could not load bookings."); })
      .finally(() => { if (active) setBookingsLoading(false); });
    return () => { active = false; };
  }, [route, user?.id, bookingsRetry]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (isSignup && password !== confirm) { setError("Passwords do not match."); return; }
    if (isSignup && password.length < 12) { setError("Use at least 12 characters for your password."); return; }
    setBusy(true);
    try { const result = await authRequest(isSignup ? "register" : "login", isSignup ? { name, email, password } : { email, password });
      if (!result.user) throw new Error("Authentication did not complete.");
      onUser(result.user); navigate("/account"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong."); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError("");
    try { await authRequest("logout"); onUser(null); navigate("/"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not log out."); }
    finally { setBusy(false); }
  }

  if (route === "/account" && user) return <section className="account-page"><div className="account-wrap">
    <div className="eyebrow section-eyebrow">YOUR SPACE AT SEATLOCK</div><h1>Welcome back,<br/><em>{user.name.split(" ")[0]}.</em></h1>
    <p className="account-intro">Your confirmed demo bookings live here. Browse the lineup and find your next favorite film.</p>
    <div className="account-grid"><article className="account-card"><div className="account-card-title"><CalendarDays size={18}/><h2>Your bookings</h2></div>{bookingsLoading ? <div className="account-empty">Loading bookings…</div> : bookingsError ? <div role="alert"><p className="form-error booking-error">{bookingsError}</p><button className="retry-button" onClick={() => { setBookingsError(""); setBookingsLoading(true); setBookingsRetry((value) => value + 1); }}>Retry bookings</button></div> : bookings.length ? <div className="booking-history">{bookings.map((booking) => <div className="booking-history-item" key={booking.id}><div className="booking-history-head"><strong>{booking.movieTitle}</strong><span>{booking.reference}</span></div><p>{new Date(booking.startsAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {booking.auditorium}</p><p>Seats {booking.seats.map((seat) => seat.label).join(", ")} · ${booking.total.toFixed(2)}</p><small>DEMO CONFIRMATION — NO PAYMENT CHARGED</small></div>)}</div> : <div className="account-empty"><span className="account-empty-icon"><CalendarDays size={26}/></span><h3>No bookings yet</h3><p>Your confirmed demo bookings will appear here. No payment is charged.</p><button className="button button-primary" onClick={() => navigate("/")}>Explore films <ArrowRight size={15}/></button></div>}</article>
    <article className="account-card account-details"><div className="account-card-title"><UserRound size={18}/><h2>Account information</h2></div><dl><dt>FULL NAME</dt><dd>{user.name}</dd><dt>EMAIL ADDRESS</dt><dd>{user.email}</dd><dt>MEMBER SINCE</dt><dd>{new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</dd></dl><button className="account-logout" onClick={logout} disabled={busy}><LogOut size={15}/>{busy ? "Signing out…" : "Log out"}</button>{error && <p className="form-error" role="alert">{error}</p>}</article></div>
  </div></section>;

  return <section className="auth-page"><div className="auth-art"><div className="auth-art-content"><div className="eyebrow section-eyebrow">YOUR NEXT GREAT NIGHT</div><h2>Every story<br/>starts <em>somewhere.</em></h2><p>Make room for the movies that move you.</p></div></div><div className="auth-panel"><div className="auth-card"><div className="eyebrow section-eyebrow">{isSignup ? "JOIN THE EXPERIENCE" : "WELCOME BACK"}</div><h1>{isSignup ? "Create your account." : "Sign in."}</h1><p className="auth-subtitle">{isSignup ? "Your seat at the movies starts here." : "Pick up where your story left off."}</p>
    <form onSubmit={submit} noValidate>{isSignup && <label>FULL NAME<span className="field"><UserRound size={16}/><input name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" required minLength={2} maxLength={100}/></span></label>}
      <label>EMAIL ADDRESS<span className="field"><Mail size={16}/><input name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required maxLength={254}/></span></label>
      <label>PASSWORD<span className="field"><LockKeyhole size={16}/><input name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isSignup ? "At least 12 characters" : "Your password"} required minLength={isSignup ? 12 : undefined}/></span></label>
      {isSignup && <label>CONFIRM PASSWORD<span className="field"><LockKeyhole size={16}/><input name="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat your password" required/></span></label>}
      {error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}<ArrowRight size={16}/></button>
    </form><p className="auth-switch">{isSignup ? "Already have an account?" : "New to SeatLock?"} <a href={isSignup ? "/login" : "/signup"}>{isSignup ? "Sign in" : "Create an account"}</a></p><p className="auth-privacy">Your password is securely hashed. We never store it in plain text.</p></div></div></section>;
}
