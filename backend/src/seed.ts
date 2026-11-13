import { movies } from "./data.js";
import { pool } from "./db.js";

function startTime(time: string): Date {
  const [clock, period] = time.split(" ");
  const [hour, minute] = clock.split(":").map(Number);
  const date = new Date();
  date.setUTCHours((hour % 12) + (period === "PM" ? 12 : 0), minute, 0, 0);
  return date;
}
function duration(runtime: string): number {
  const match = runtime.match(/(\d+)h\s+(\d+)m/);
  if (!match) throw new Error(`Invalid runtime: ${runtime}`);
  return Number(match[1]) * 60 + Number(match[2]);
}
export async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [index, movie] of movies.entries()) {
      await client.query(`INSERT INTO movies (id,title,description,genre,duration_minutes,poster_url,rating,accent)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [movie.id, movie.title, movie.synopsis, movie.genre, duration(movie.runtime), movie.image, movie.rating, movie.accent]);
      const auditorium = await client.query<{ id: string }>("INSERT INTO auditoriums(name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id", [`Screen ${index + 1}`]);
      const auditoriumId = auditorium.rows[0].id;
      for (const row of ["A", "B", "C", "D", "E"]) for (let number = 1; number <= 8; number++)
        await client.query("INSERT INTO seats(auditorium_id,row_label,seat_number) VALUES ($1,$2,$3) ON CONFLICT (auditorium_id,row_label,seat_number) DO NOTHING", [auditoriumId, row, number]);
      for (const show of movie.showtimes) await client.query(`INSERT INTO showtimes(id,movie_id,auditorium_id,starts_at,base_price,format)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`, [show.id, movie.id, auditoriumId, startTime(show.time), show.price, show.format]);
    }
    await client.query("COMMIT");
    console.log("Development seed complete (existing rows preserved).");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
if (process.argv[1]?.endsWith("seed.js")) seed().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
