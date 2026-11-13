import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, Check, Clock3, MapPin, Menu, Plus, Popcorn, Search, ShieldCheck, Ticket, X } from "lucide-react";
import AccountPages, { type AuthUser } from "./AccountPages";
import BookingFlow from "./BookingFlow";

type Showtime = { id: string; time: string; format: string; price: number; date: string };
type Movie = { id: string; title: string; genre: string; rating: string; runtime: string; synopsis: string; image: string; accent: string; showtimes: Showtime[] };
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
  const [notice, setNotice] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [route, setRoute] = useState(window.location.pathname);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const navigate = (path: string) => { window.history.pushState({}, "", path); setRoute(path); window.scrollTo(0, 0); };
  const logout = async () => {
    try { const response = await fetch(`${API}/auth/logout`, { method: "POST", headers: { "X-SeatLock-Request": "1" }, credentials: "same-origin" });
      if (!response.ok) throw new Error("Could not log out. Please try again."); setUser(null); navigate("/"); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not log out."); }
  };

  useEffect(() => { fetchMovies().then((items) => {
    setMovies(items);
    try { const saved = JSON.parse(sessionStorage.getItem("seatlock.activeHold") ?? "null") as { movieId?: string } | null;
      const movie = items.find((item) => item.id === saved?.movieId); if (movie) setSelectedMovie(movie); }
    catch { sessionStorage.removeItem("seatlock.activeHold"); }
  }).catch((e: unknown) => setError(e instanceof Error ? e.message : "Unable to reach the SeatLock API.")).finally(() => setLoading(false)); }, []);
  useEffect(() => { const onPop = () => setRoute(window.location.pathname); window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);
  useEffect(() => { fetch(`${API}/auth/me`, { credentials: "same-origin" }).then(async (response) => response.ok ? response.json() : null)
    .then((payload: { user: AuthUser } | null) => setUser(payload?.user ?? null)).catch(() => setUser(null)).finally(() => setAuthLoading(false)); }, []);
  useEffect(() => { if (!authLoading && route === "/account" && !user) navigate("/login"); }, [authLoading, route, user]);
  useEffect(() => { if (!authLoading && user && (route === "/login" || route === "/signup")) navigate("/account"); }, [authLoading, route, user]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 3600); return () => window.clearTimeout(timer); }, [notice]);
  const featured = movies[0];
  const filteredMovies = useMemo(() => movies.filter((movie) => movie.title.toLowerCase().includes(query.toLowerCase()) || movie.genre.toLowerCase().includes(query.toLowerCase())), [movies, query]);

  const openMovie = (movie: Movie) => setSelectedMovie(movie);

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="/" aria-label="SeatLock home"><span className="brand-mark"><Ticket size={18}/></span><span>seat<span className="brand-lock">lock</span></span></a><nav className="main-nav"><a className={route === "/" ? "nav-active" : ""} href="/#films">Now showing</a><a href="/#experience">The experience</a><a href="/#about">About us</a></nav><div className="top-actions"><button className="icon-button search-toggle" aria-label="Search films" aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Search size={18}/></button><span className="location-pill"><MapPin size={15}/> <span>Demo cinema</span></span>{!authLoading && (user ? <><a className="auth-nav" href="/account">Account</a><button className="auth-nav auth-nav-button" onClick={logout}>Log out</button></> : <><a className="auth-nav" href="/login">Log in</a><a className="auth-nav auth-nav-signup" href="/signup">Sign up</a></>)}<button className="menu-button" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button></div></header>
    {menuOpen && <nav id="mobile-navigation" className="mobile-nav" aria-label="Mobile navigation"><a href="/#films" onClick={() => setMenuOpen(false)}>Now showing</a><a href="/#experience" onClick={() => setMenuOpen(false)}>The experience</a><a href="/#about" onClick={() => setMenuOpen(false)}>About us</a></nav>}
    {searchOpen && <div className="search-bar"><Search size={17}/><input autoFocus placeholder="Search films or genres…" value={query} onChange={(e) => setQuery(e.target.value)}/><button className="icon-button" onClick={() => { setSearchOpen(false); setQuery(""); }} aria-label="Close search"><X size={17}/></button></div>}
    <main id="top">{route === "/" ? <>
      {error && <div className="error-banner" role="alert"><span>{error} Please check the API connection.</span><button onClick={() => { setLoading(true); setError(""); fetchMovies().then(setMovies).catch(() => setError("The SeatLock API is still unavailable." )).finally(() => setLoading(false)); }}>Try again</button></div>}
      <section className="hero" style={featured ? { backgroundImage: `linear-gradient(90deg, rgba(12,12,12,.98) 0%, rgba(12,12,12,.86) 33%, rgba(12,12,12,.15) 75%), linear-gradient(0deg, #101010 0%, transparent 35%), url(${featured.image})` } : undefined}>
        <div className="hero-content"><div className="eyebrow"><span className="eyebrow-line"/> THE BIG SCREEN, YOUR WAY</div><h1>{featured ? <>A little more<br/><em>movie</em> magic.</> : loading ? <>The lights are<br/><em>coming up.</em></> : <>Your next great<br/><em>night out.</em></>}</h1><p className="hero-copy">Good stories deserve a great seat. Discover what's on, pick your spot, and make a night of it.</p><div className="hero-buttons"><a className="button button-primary" href="#films">Explore films <ArrowRight size={16}/></a><a className="button button-quiet" href="#experience">The SeatLock experience <ArrowDown size={15}/></a></div><div className="hero-note"><span className="note-dot"/> {loading ? "Loading sample films…" : "CURATED FOR YOUR NEXT NIGHT OUT"}</div></div>
        <div className="hero-side-note"><span>01</span><i/> FOUR STORIES. ONE GREAT NIGHT.</div><div className="hero-pagination"><span className="page-active"/><span/><span/><span/></div>
      </section>
      <section id="films" className="films-section"><div className="section-head"><div><div className="eyebrow section-eyebrow">ON THE MARQUEE</div><h2>Now showing<span className="period">.</span></h2></div><a className="text-link" href="#films">See all films <ArrowRight size={15}/></a></div>
        <div className="film-grid">{loading ? [1,2,3,4].map((i) => <div key={i} className="film-skeleton"/>) : filteredMovies.map((movie, index) => <article key={movie.id} className="film-card" style={{ "--accent": movie.accent } as React.CSSProperties}>
          <button className="poster-button" onClick={() => openMovie(movie)} aria-label={`View ${movie.title} details`}><img src={movie.image} alt={`${movie.title} sample artwork`} loading="lazy"/><span className="poster-vignette"/><span className="poster-index">0{index + 1}</span><span className="poster-action"><Plus size={16}/></span><span className="poster-title">{movie.title}</span></button>
          <div className="film-meta"><div><p className="film-genre">{movie.genre}</p><h3>{movie.title}</h3></div><span className="rating">{movie.rating}</span></div><div className="film-submeta"><span><Clock3 size={13}/>{movie.runtime}</span><span className="submeta-dot"/> <span>{movie.showtimes.length ? `From $${Math.min(...movie.showtimes.map((s) => s.price))}` : "No shows yet"}</span><button className="showtime-link" onClick={() => openMovie(movie)}>Showtimes <ArrowRight size={13}/></button></div>
        </article>)}</div>{!loading && filteredMovies.length === 0 && <p className="empty-state">No films match “{query}”. Try a different title or genre.</p>}
        <div className="sample-caption"><span className="caption-line"/> SAMPLE FILMS &amp; SHOWTIMES <span>Illustrative content for portfolio preview</span></div>
      </section>
      <section className="experience-section" id="experience"><div className="experience-image"><img src="https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=85" alt="Warmly lit cinema seats"/><div className="image-label"><span>01 / 03</span><span>THE SEATLOCK EXPERIENCE</span></div></div><div className="experience-copy"><div className="eyebrow section-eyebrow">A BETTER WAY TO GO</div><h2>Make room<br/>for <em>the moment.</em></h2><p>From the first preview to the final credits, the best nights at the movies feel effortless. Find your film, settle into your seat, and let the rest fade away.</p><div className="experience-perks"><div><span className="perk-icon"><ShieldCheck size={17}/></span><span><b>Your night, thoughtfully planned</b><small>Explore times and seating in one place.</small></span></div><div><span className="perk-icon"><Popcorn size={17}/></span><span><b>Made for movie people</b><small>A considered lineup for every kind of mood.</small></span></div></div><button className="button button-outline" onClick={() => document.getElementById("films")?.scrollIntoView({ behavior: "smooth" })}>Find your film <ArrowRight size={15}/></button></div></section>
    </> : authLoading ? <section className="auth-loading">Loading account…</section> : <AccountPages key={route} route={route} user={user} onUser={setUser} navigate={navigate}/>}</main>
    <footer id="about"><a className="brand footer-brand" href="#top"><span className="brand-mark"><Ticket size={17}/></span><span>seat<span className="brand-lock">lock</span></span></a><span className="footer-note">A better night at the movies starts here.</span><span className="footer-copy">© 2026 SEATLOCK · SAMPLE EXPERIENCE</span></footer>

    {selectedMovie && <BookingFlow movie={selectedMovie} user={user} onClose={() => setSelectedMovie(null)} onLogin={() => { setSelectedMovie(null); navigate("/login"); }} onAccount={() => { setSelectedMovie(null); navigate("/account"); }}/>}
    {notice && <div className="toast"><Check size={16}/>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15}/></button></div>}
  </div>;
}
export default App;
