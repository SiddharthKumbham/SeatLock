import { query } from "./db.js";
import { demoMode } from "./config.js";

type MovieRow = { id: string; title: string; description: string; genre: string; duration_minutes: number; poster_url: string; rating: string; accent: string };
type ShowRow = { id: string; movie_id: string; auditorium_id: string; auditorium_name: string; starts_at: Date; base_price: string; format: string };
const movieSql = "SELECT id,title,description,genre,duration_minutes,poster_url,rating,accent FROM movies";
const showSql = `SELECT s.id,s.movie_id,s.auditorium_id,a.name AS auditorium_name,s.starts_at,s.base_price,s.format FROM showtimes s JOIN auditoriums a ON a.id=s.auditorium_id`;
export const mapShow = (row: ShowRow) => ({ id: row.id, movieId: row.movie_id, auditorium: row.auditorium_name,
  time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(row.starts_at),
  date: row.starts_at.toISOString().slice(0, 10), startsAt: row.starts_at.toISOString(), format: row.format, price: Number(row.base_price) });
const mapMovie = (row: MovieRow, showtimes: ReturnType<typeof mapShow>[]) => ({ id: row.id, title: row.title, genre: row.genre,
  rating: row.rating, runtime: `${Math.floor(row.duration_minutes / 60)}h ${row.duration_minutes % 60}m`, synopsis: row.description,
  image: row.poster_url, accent: row.accent, showtimes });
export async function listMovies() {
  const filter = demoMode ? " WHERE s.starts_at > clock_timestamp()" : "";
  const [movies, shows] = await Promise.all([query<MovieRow>(`${movieSql} ORDER BY created_at,id`), query<ShowRow>(`${showSql}${filter} ORDER BY s.starts_at,s.id`)]);
  return movies.rows.map((movie) => mapMovie(movie, shows.rows.filter((show) => show.movie_id === movie.id).map(mapShow)));
}
export async function listShowtimes(movieId: string) {
  const future = demoMode ? " AND s.starts_at > clock_timestamp()" : "";
  const result = await query<ShowRow>(`${showSql} WHERE s.movie_id=$1${future} ORDER BY s.starts_at,s.id`, [movieId]);
  return result.rows.map(mapShow);
}
export async function findMovie(id: string) {
  const result = await query<MovieRow>(`${movieSql} WHERE id=$1`, [id]);
  return result.rows[0] ? mapMovie(result.rows[0], await listShowtimes(id)) : null;
}
export async function showtimeSeats(id: string) {
  const show = await query<ShowRow>(`${showSql} WHERE s.id=$1`, [id]);
  if (!show.rows[0]) return null;
  const seats = await query<{ id: string; row_label: string; seat_number: number }>("SELECT id,row_label,seat_number FROM seats WHERE auditorium_id=$1 ORDER BY row_label,seat_number", [show.rows[0].auditorium_id]);
  return { showtime: mapShow(show.rows[0]), seats: seats.rows.map((seat) => ({ id: seat.id, rowLabel: seat.row_label, seatNumber: seat.seat_number, label: `${seat.row_label}${seat.seat_number}` })) };
}
