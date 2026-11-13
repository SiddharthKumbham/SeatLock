import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, Film, MapPin, Menu, Plus, Popcorn, Search, ShieldCheck, Ticket, X } from "lucide-react";

type Showtime = { id: string; time: string; format: string; price: number; date: string };
type Movie = { id: string; title: string; genre: string; rating: string; runtime: string; synopsis: string; image: string; accent: string; showtimes: Showtime[] };
type Seat = { id: string; rowLabel: string; seatNumber: number; label: string };
const API = "/api";

async function fetchMovies(): Promise<Movie[]> {
  const response = await fetch(`${API}/movies`);
  if (!response.ok) throw new Error("We couldn't load the films right now.");
  const payload: { data: Movie[] } = await response.json();
  return payload.data;
}

function App() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [selectedShow, setSelectedShow] = useState<Showtime | null>(null);
  const [showtimes, setShowtimes] = useState<Showtime[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => { fetchMovies().then(setMovies).catch((e: unknown) => setError(e instanceof Error ? e.message : "Unable to reach the SeatLock API.")).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 3600); return () => window.clearTimeout(timer); }, [notice]);
  const featured = movies[0];
  const filteredMovies = useMemo(() => movies.filter((movie) => movie.title.toLowerCase().includes(query.toLowerCase()) || movie.genre.toLowerCase().includes(query.toLowerCase())), [movies, query]);

  const openMovie = (movie: Movie) => {
    setSelectedMovie(movie); setSelectedShow(null); setSelectedSeats([]); setShowtimes([]); setSeats([]); setBookingError(""); setBookingLoading(true);
    fetch(`${API}/showtimes?movieId=${encodeURIComponent(movie.id)}`).then(async (response) => { if (!response.ok) throw new Error("Could not load showtimes."); return response.json(); })
      .then((payload: { data: Showtime[] }) => setShowtimes(payload.data)).catch((e: Error) => setBookingError(e.message)).finally(() => setBookingLoading(false));
  };
  const chooseShow = (show: Showtime) => {
    setSelectedShow(show); setSelectedSeats([]); setSeats([]); setBookingError(""); setBookingLoading(true);
    fetch(`${API}/showtimes/${encodeURIComponent(show.id)}/seats`).then(async (response) => { if (!response.ok) throw new Error("Could not load seats."); return response.json(); })
      .then((payload: { data: { seats: Seat[] } }) => setSeats(payload.data.seats)).catch((e: Error) => setBookingError(e.message)).finally(() => setBookingLoading(false));
  };
  const toggleSeat = (seat: string) => setSelectedSeats((current) => current.includes(seat) ? current.filter((item) => item !== seat) : current.length < 6 ? [...current, seat] : current);
  const confirmSampleSelection = () => { setNotice(`Sample selection: ${selectedSeats.join(", ")} for ${selectedMovie?.title}. No booking was made.`); setSelectedMovie(null); };

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#top" aria-label="SeatLock home"><span className="brand-mark"><Ticket size={18}/></span><span>seat<span className="brand-lock">lock</span></span></a><nav className="main-nav"><a className="nav-active" href="#films">Now showing</a><a href="#experience">The experience</a><a href="#about">About us</a></nav><div className="top-actions"><button className="icon-button search-toggle" aria-label="Search films" onClick={() => setSearchOpen(!searchOpen)}><Search size={18}/></button><button className="location-pill"><MapPin size={15}/> <span>New York, NY</span><ChevronDown size={14}/></button><button className="menu-button" aria-label="Open menu"><Menu size={20}/></button></div></header>
    {searchOpen && <div className="search-bar"><Search size={17}/><input autoFocus placeholder="Search films or genres…" value={query} onChange={(e) => setQuery(e.target.value)}/><button className="icon-button" onClick={() => { setSearchOpen(false); setQuery(""); }} aria-label="Close search"><X size={17}/></button></div>}
    <main id="top">
      {error && <div className="error-banner"><span>{error} Check that the backend is running on port 4000.</span><button onClick={() => { setLoading(true); setError(""); fetchMovies().then(setMovies).catch(() => setError("The SeatLock API is still unavailable." )).finally(() => setLoading(false)); }}>Try again</button></div>}
      <section className="hero" style={featured ? { backgroundImage: `linear-gradient(90deg, rgba(12,12,12,.98) 0%, rgba(12,12,12,.86) 33%, rgba(12,12,12,.15) 75%), linear-gradient(0deg, #101010 0%, transparent 35%), url(${featured.image})` } : undefined}>
        <div className="hero-content"><div className="eyebrow"><span className="eyebrow-line"/> THE BIG SCREEN, YOUR WAY</div><h1>{featured ? <>A little more<br/><em>movie</em> magic.</> : loading ? <>The lights are<br/><em>coming up.</em></> : <>Your next great<br/><em>night out.</em></>}</h1><p className="hero-copy">Good stories deserve a great seat. Discover what's on, pick your spot, and make a night of it.</p><div className="hero-buttons"><a className="button button-primary" href="#films">Explore films <ArrowRight size={16}/></a><a className="button button-quiet" href="#experience">The SeatLock experience <ArrowDown size={15}/></a></div><div className="hero-note"><span className="note-dot"/> {loading ? "Loading sample films…" : "CURATED FOR YOUR NEXT NIGHT OUT"}</div></div>
        <div className="hero-side-note"><span>01</span><i/> FOUR STORIES. ONE GREAT NIGHT.</div><div className="hero-pagination"><span className="page-active"/><span/><span/><span/></div>
      </section>
      <section id="films" className="films-section"><div className="section-head"><div><div className="eyebrow section-eyebrow">ON THE MARQUEE</div><h2>Now showing<span className="period">.</span></h2></div><a className="text-link" href="#all-films">See all films <ArrowRight size={15}/></a></div>
        <div className="film-grid">{loading ? [1,2,3,4].map((i) => <div key={i} className="film-skeleton"/>) : filteredMovies.map((movie, index) => <article key={movie.id} className="film-card" style={{ "--accent": movie.accent } as React.CSSProperties}>
          <button className="poster-button" onClick={() => openMovie(movie)} aria-label={`View ${movie.title} details`}><img src={movie.image} alt={`${movie.title} sample artwork`} loading="lazy"/><span className="poster-vignette"/><span className="poster-index">0{index + 1}</span><span className="poster-action"><Plus size={16}/></span><span className="poster-title">{movie.title}</span></button>
          <div className="film-meta"><div><p className="film-genre">{movie.genre}</p><h3>{movie.title}</h3></div><span className="rating">{movie.rating}</span></div><div className="film-submeta"><span><Clock3 size={13}/>{movie.runtime}</span><span className="submeta-dot"/> <span>From ${Math.min(...movie.showtimes.map((s) => s.price))}</span><button className="showtime-link" onClick={() => openMovie(movie)}>Showtimes <ArrowRight size={13}/></button></div>
        </article>)}</div>{!loading && filteredMovies.length === 0 && <p className="empty-state">No films match “{query}”. Try a different title or genre.</p>}
        <div className="sample-caption"><span className="caption-line"/> SAMPLE FILMS &amp; SHOWTIMES <span>Illustrative content for portfolio preview</span></div>
      </section>
      <section className="experience-section" id="experience"><div className="experience-image"><img src="https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=85" alt="Warmly lit cinema seats"/><div className="image-label"><span>01 / 03</span><span>THE SEATLOCK EXPERIENCE</span></div></div><div className="experience-copy"><div className="eyebrow section-eyebrow">A BETTER WAY TO GO</div><h2>Make room<br/>for <em>the moment.</em></h2><p>From the first preview to the final credits, the best nights at the movies feel effortless. Find your film, settle into your seat, and let the rest fade away.</p><div className="experience-perks"><div><span className="perk-icon"><ShieldCheck size={17}/></span><span><b>Your night, thoughtfully planned</b><small>Explore times and seating in one place.</small></span></div><div><span className="perk-icon"><Popcorn size={17}/></span><span><b>Made for movie people</b><small>A considered lineup for every kind of mood.</small></span></div></div><button className="button button-outline" onClick={() => document.getElementById("films")?.scrollIntoView({ behavior: "smooth" })}>Find your film <ArrowRight size={15}/></button></div></section>
    </main>
    <footer id="about"><a className="brand footer-brand" href="#top"><span className="brand-mark"><Ticket size={17}/></span><span>seat<span className="brand-lock">lock</span></span></a><span className="footer-note">A better night at the movies starts here.</span><span className="footer-copy">© 2026 SEATLOCK · SAMPLE EXPERIENCE</span></footer>

    {selectedMovie && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedMovie(null); }}><section className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title"><button className="modal-close" aria-label="Close" onClick={() => setSelectedMovie(null)}><X size={19}/></button><div className="modal-poster" style={{ backgroundImage: `linear-gradient(0deg, #151515, transparent 70%), url(${selectedMovie.image})` }}><span className="modal-tag">{selectedMovie.genre}</span></div><div className="modal-body"><div className="modal-heading"><div><p className="film-genre">{selectedMovie.rating} <span className="submeta-dot"/> {selectedMovie.runtime}</p><h2 id="booking-title">{selectedMovie.title}</h2></div><button className="back-link" onClick={() => setSelectedMovie(null)}><ArrowLeft size={14}/> Back</button></div><p className="modal-synopsis">{selectedMovie.synopsis}</p><div className="modal-divider"/><div className="modal-label">SHOWTIMES <span>Sample schedule · {showtimes[0]?.date ?? ""}</span></div>{bookingLoading && !selectedShow && <div className="modal-hint">Loading showtimes…</div>}{bookingError && <div className="modal-hint" role="alert">{bookingError}</div>}<div className="showtime-list">{showtimes.map((show) => <button key={show.id} className={`showtime-chip ${selectedShow?.id === show.id ? "showtime-selected" : ""}`} onClick={() => chooseShow(show)}><b>{show.time}</b><small>{show.format} · ${show.price}</small></button>)}</div>{!bookingLoading && !bookingError && !showtimes.length && <div className="modal-hint">No showtimes are available.</div>}
      {selectedShow && <div className="seat-picker"><div className="seat-picker-head"><div><div className="modal-label">PICK YOUR SEATS</div><p>Choose up to 6 seats · ${selectedShow.price} each</p></div><span className="sample-badge">SAMPLE ONLY</span></div>{bookingLoading && <div className="modal-hint">Loading seats…</div>}{!bookingLoading && !bookingError && !seats.length && <div className="modal-hint">No seats are configured for this screen.</div>}{seats.length > 0 && <><div className="screen-curve"><span>SCREEN</span></div><div className="seat-grid" aria-label="Seat selection">{[...new Set(seats.map((seat) => seat.rowLabel))].map((row) => <div className="seat-row" key={row}><span className="row-label">{row}</span>{seats.filter((seat) => seat.rowLabel === row).map((seat) => <button key={seat.id} aria-label={`Seat ${seat.label}${selectedSeats.includes(seat.label) ? ", selected" : ""}`} className={`seat ${selectedSeats.includes(seat.label) ? "seat-selected" : ""}`} onClick={() => toggleSeat(seat.label)}>{selectedSeats.includes(seat.label) ? <Check size={11}/> : null}</button>)}<span className="row-label">{row}</span></div>)}</div><div className="seat-legend"><span><i className="legend-seat"/> Seat</span><span><i className="legend-seat legend-selected"/> Selected</span></div><div className="seat-summary"><span>{selectedSeats.length ? `${selectedSeats.length} seat${selectedSeats.length > 1 ? "s" : ""} selected` : "Select seats to continue"}</span><b>${(selectedSeats.length * selectedShow.price).toFixed(2)}</b></div><button className="button button-primary confirm-button" disabled={!selectedSeats.length} onClick={confirmSampleSelection}>Continue <ArrowRight size={15}/></button></>}<p className="demo-disclaimer">Demo only. These are physical seat positions, with no availability or reservation status.</p></div>}
      {!selectedShow && <div className="modal-hint"><Film size={15}/> Select a showtime to see the sample seating plan.</div>}
    </div></section></div>}
    {notice && <div className="toast"><Check size={16}/>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15}/></button></div>}
  </div>;
}
export default App;
