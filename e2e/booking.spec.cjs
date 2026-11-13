const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");

const tag = randomUUID();
const movieId = `e2e-${tag}`;
const showtimeId = `e2e-show-${tag}`;
const title = `E2E TEST FILM ${tag.slice(0, 6).toUpperCase()}`;
const emails = [`e2e-a-${tag}@example.test`, `e2e-b-${tag}@example.test`];
const password = `Test-only-${randomUUID()}!`;
let pool;
let auditoriumId;
let seatIds = [];

test.beforeAll(async () => {
  ({ pool } = await import("../backend/dist/db.js"));
  const room = await pool.query("INSERT INTO auditoriums(name) VALUES ($1) RETURNING id", [`E2E Screen ${tag}`]);
  auditoriumId = room.rows[0].id;
  await pool.query(`INSERT INTO movies(id,title,description,genre,duration_minutes,poster_url,rating,accent)
    VALUES ($1,$2,'A temporary end-to-end test film.','TEST',90,$3,'PG','#c8a77b')`,
    [movieId, title, "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=800&q=80"]);
  await pool.query("INSERT INTO showtimes(id,movie_id,auditorium_id,starts_at,base_price,format) VALUES ($1,$2,$3,clock_timestamp()+interval '1 day',14.00,'STANDARD')", [showtimeId, movieId, auditoriumId]);
  for (let number = 1; number <= 4; number++) {
    const seat = await pool.query("INSERT INTO seats(auditorium_id,row_label,seat_number) VALUES ($1,'A',$2) RETURNING id", [auditoriumId, number]);
    seatIds.push(seat.rows[0].id);
  }
});
test.afterAll(async () => {
  if (!pool) return;
  if (auditoriumId) {
    await pool.query("DELETE FROM booking_seats WHERE showtime_id=$1", [showtimeId]);
    await pool.query("DELETE FROM seat_claims WHERE showtime_id=$1", [showtimeId]);
    await pool.query("DELETE FROM bookings WHERE showtime_id=$1", [showtimeId]);
    await pool.query("DELETE FROM seat_holds WHERE showtime_id=$1", [showtimeId]);
    await pool.query("DELETE FROM seats WHERE auditorium_id=$1", [auditoriumId]);
    await pool.query("DELETE FROM showtimes WHERE id=$1", [showtimeId]);
    await pool.query("DELETE FROM movies WHERE id=$1", [movieId]);
    await pool.query("DELETE FROM auditoriums WHERE id=$1", [auditoriumId]);
  }
  await pool.query("DELETE FROM users WHERE email=ANY($1::text[])", [emails]);
  await pool.end();
});

async function register(page, email) {
  await page.goto("/signup");
  await page.getByRole("textbox", { name: "FULL NAME" }).fill("Browser Test");
  await page.getByRole("textbox", { name: "EMAIL ADDRESS" }).fill(email);
  await page.getByLabel("PASSWORD", { exact: true }).fill(password);
  await page.getByLabel("CONFIRM PASSWORD").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
}
async function openShowtime(page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: `View ${title} details` })).toBeVisible();
  await page.getByRole("button", { name: `View ${title} details` }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: /STANDARD · \$14/ }).click();
  await expect(page.getByRole("button", { name: "Seat A1, available" })).toBeVisible();
}

test("two browser contexts see holds and bookings, with refresh recovery", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await register(pageA, emails[0]);
    await register(pageB, emails[1]);
    await openShowtime(pageA);
    await openShowtime(pageB);
    await pageA.getByRole("button", { name: "Seat A1, available" }).click();
    await pageA.getByRole("button", { name: "Hold seats for 5 minutes" }).click();
    await expect(pageA.getByRole("timer")).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Seat A1, held" })).toBeDisabled({ timeout: 4000 });

    await pageA.reload();
    await expect(pageA.getByText("Your reservation was restored.")).toBeVisible();
    await expect(pageA.getByRole("timer")).toBeVisible();
    await pageA.getByRole("button", { name: "Release seats" }).click();
    await expect(pageB.getByRole("button", { name: "Seat A1, available" })).toBeEnabled({ timeout: 4000 });

    await pageB.getByRole("button", { name: "Seat A1, available" }).click();
    await pageB.getByRole("button", { name: "Hold seats for 5 minutes" }).click();
    await expect(pageB.getByRole("timer")).toBeVisible();
    await pageB.getByRole("button", { name: "Release seats" }).click();

    await pageA.getByRole("button", { name: "Seat A2, available" }).click();
    await pageA.getByRole("button", { name: "Hold seats for 5 minutes" }).click();
    await pageA.getByRole("button", { name: /Demo Confirmation — No Payment Charged/ }).click();
    await expect(pageA.getByText("You're on the list.")).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Seat A2, booked" })).toBeDisabled({ timeout: 4000 });
    await contextB.setOffline(true);
    await expect(pageB.getByText("RECONNECTING · POLLING BACKUP")).toBeVisible();
    await contextB.setOffline(false);
    await expect(pageB.getByText("LIVE AVAILABILITY")).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Seat A2, booked" })).toBeDisabled();
    await pageB.screenshot({ path: "test-results/seatlock-booking-state.png" });
    await pageA.getByRole("button", { name: "View your bookings" }).click();
    await expect(pageA.getByText(title)).toBeVisible();
    await expect(pageA.getByText("DEMO CONFIRMATION — NO PAYMENT CHARGED")).toBeVisible();
    await pageA.getByRole("button", { name: "Log out" }).first().click();
    await expect(pageA.getByRole("link", { name: "Log in" })).toBeVisible();
    await pageA.goto("/login");
    await pageA.getByRole("textbox", { name: "EMAIL ADDRESS" }).fill(emails[0]);
    await pageA.getByLabel("PASSWORD", { exact: true }).fill(password);
    await pageA.getByRole("button", { name: "Sign in" }).click();
    await expect(pageA.getByText(title)).toBeVisible();
    await pageA.getByRole("button", { name: "Log out" }).first().click();
  } finally {
    await contextA.close(); await contextB.close();
  }
});
