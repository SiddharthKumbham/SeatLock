const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const tag = randomUUID();
const movieId = `e2e-${tag}`;
const showtimeId = `e2e-show-${tag}`;
const title = "THE LAST SIGNAL";
const screenshotDir = path.join(__dirname, "..", "docs", "screenshots");
const capturePortfolioScreenshots = process.env.CAPTURE_SCREENSHOTS === "true";
const emails = [`demo.guest.${tag.slice(0, 8)}@example.test`, `demo.viewer.${tag.slice(0, 8)}@example.test`];
const password = `Test-only-${randomUUID()}!`;
let pool;
let auditoriumId;
let seatIds = [];

test.beforeAll(async () => {
  ({ pool } = await import("../backend/dist/db.js"));
  const room = await pool.query("INSERT INTO auditoriums(name) VALUES ($1) RETURNING id", [`Demo Screen ${tag.slice(0, 6)}`]);
  auditoriumId = room.rows[0].id;
  await pool.query(`INSERT INTO movies(id,title,description,genre,duration_minutes,poster_url,rating,accent)
    VALUES ($1,$2,'A distant transmission leads a crew toward one final discovery.','SCI-FI · DRAMA',90,$3,'PG-13','#c8a77b')`,
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
  await page.getByRole("textbox", { name: "FULL NAME" }).fill("Demo Guest");
  await page.getByRole("textbox", { name: "EMAIL ADDRESS" }).fill(email);
  await page.getByLabel("PASSWORD", { exact: true }).fill(password);
  await page.getByLabel("CONFIRM PASSWORD").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
}
async function openShowtime(page, capture = false) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: `View ${title} details` })).toBeVisible();
  await page.getByRole("button", { name: `View ${title} details` }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  if (capture) await page.screenshot({ path: path.join(screenshotDir, "03-showtimes.png") });
  await page.getByRole("button", { name: /STANDARD · \$14/ }).click();
  await expect(page.getByRole("button", { name: "Seat A1, available" })).toBeVisible();
}

test("two browser contexts see holds and bookings, with refresh recovery", async ({ browser }) => {
  if (capturePortfolioScreenshots) fs.mkdirSync(screenshotDir, { recursive: true });
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await pageA.goto("/");
    await expect(pageA.getByRole("button", { name: "View AFTERLIGHT details" })).toBeVisible();
    if (capturePortfolioScreenshots) await pageA.screenshot({ path: path.join(screenshotDir, "01-homepage.png") });
    await pageA.locator("#films").scrollIntoViewIfNeeded();
    await pageA.setViewportSize({ width: 1440, height: 720 });
    if (capturePortfolioScreenshots) await pageA.screenshot({ path: path.join(screenshotDir, "02-movie-catalog.png"), clip: { x: 0, y: 0, width: 1440, height: 620 } });
    await pageA.setViewportSize({ width: 1440, height: 900 });
    await register(pageA, emails[0]);
    await register(pageB, emails[1]);
    await openShowtime(pageA, capturePortfolioScreenshots);
    await openShowtime(pageB);
    await pageA.getByRole("button", { name: "Seat A1, available" }).click();
    if (capturePortfolioScreenshots) await pageA.screenshot({ path: path.join(screenshotDir, "04-seat-selection.png") });
    await pageA.getByRole("button", { name: "Seat A1, selected" }).click();
    await pageA.getByRole("button", { name: "Seat A1, available" }).click();
    await pageA.getByRole("button", { name: "Hold seats for up to 5 minutes" }).click();
    await expect(pageA.getByRole("timer")).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Seat A1, held" })).toBeDisabled({ timeout: 4000 });

    await pageA.reload();
    await expect(pageA.getByText("Your reservation was restored.")).toBeVisible();
    await expect(pageA.getByRole("timer")).toBeVisible();
    await pageA.getByRole("button", { name: "Release seats" }).click();
    await expect(pageB.getByRole("button", { name: "Seat A1, available" })).toBeEnabled({ timeout: 4000 });

    await pageB.getByRole("button", { name: "Seat A1, available" }).click();
    await pageB.getByRole("button", { name: "Hold seats for up to 5 minutes" }).click();
    await expect(pageB.getByRole("timer")).toBeVisible();
    await pageB.getByRole("button", { name: "Release seats" }).click();

    await pageA.getByRole("button", { name: "Seat A2, available" }).click();
    await pageA.getByRole("button", { name: "Hold seats for up to 5 minutes" }).click();
    await pageA.getByRole("button", { name: /Demo Confirmation — No Payment Charged/ }).click();
    await expect(pageA.getByText("You're on the list.")).toBeVisible();
    if (capturePortfolioScreenshots) await pageA.screenshot({ path: path.join(screenshotDir, "05-demo-confirmation.png") });
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
    if (capturePortfolioScreenshots) await pageA.screenshot({ path: path.join(screenshotDir, "06-dashboard.png") });
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

test("mobile navigation exposes section links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Open menu" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "The experience" })).toBeVisible();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "The experience" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toHaveCount(0);
});

test("showtime chips show their own UTC dates and close while the modal is open", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "Asia/Kolkata" });
  try {
    const page = await context.newPage();
    await page.route(/\/api\/showtimes\?movieId=/, (route) => route.fulfill({
      json: { serverTime: "2026-11-13T23:59:57.000Z", data: [
        { id: showtimeId, startsAt: "2026-11-14T00:00:00.000Z", date: "2026-11-14", time: "12:00 AM", format: "STANDARD", price: 14 },
        { id: "next-day", startsAt: "2026-11-15T00:00:00.000Z", date: "2026-11-15", time: "12:00 AM", format: "STANDARD", price: 14 },
      ] },
    }));
    await page.goto("/");
    await page.getByRole("button", { name: `View ${title} details` }).click();
    await expect(page.getByText("Demo cinema time (UTC)")).toBeVisible();
    const first = page.getByRole("button", { name: /12:00 AM 2026-11-14/ });
    const second = page.getByRole("button", { name: /12:00 AM 2026-11-15/ });
    await expect(first).toBeEnabled();
    await expect(first).toBeDisabled({ timeout: 6500 });
    await expect(first).toContainText("Already started");
    await expect(second).toBeEnabled();
  } finally {
    await context.close();
  }
});
