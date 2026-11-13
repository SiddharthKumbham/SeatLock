# SeatLock

SeatLock is a portfolio movie-ticket application with PostgreSQL-backed authentication, five-minute seat holds, confirmed demo bookings, and live seat availability notifications. No real payment is processed.

## PostgreSQL development setup

Use a local PostgreSQL 17 database or Docker Desktop with Compose. Copy `.env.example` to `.env`, then set a unique local password in both `POSTGRES_PASSWORD` and `DATABASE_URL`. The `.env` file is ignored by Git. Never commit credentials.

```sh
docker compose up -d --wait
npm install
npm install --prefix backend
npm install --prefix frontend
npm run migrate --prefix backend
npm run seed --prefix backend
npm run dev
```

The database is stored in the persistent `seatlock_pgdata` Docker volume. Migrations are numbered SQL files in `backend/migrations`; the runner records applied versions in `schema_migrations` and runs each migration in a transaction. Migration 002 adds `auth_sessions`; migration 003 adds the booking engine. The development seed inserts four sample movies, showtimes, screens, and 40 physical seats per screen. Rerunning it preserves existing rows. Restarting the backend does not erase database rows. If port 5432 is occupied, change both `POSTGRES_PORT` and the port in `DATABASE_URL` in `.env` (this machine uses 55432).

The default API URL is <http://127.0.0.1:4000> and the default Vite frontend URL is <http://127.0.0.1:5173>. Check that both ports are free before using `npm run dev`; Vite may otherwise select a different port, which must also match `FRONTEND_ORIGIN`. On this machine port 5173 is occupied by an unrelated app, so a SeatLock preview was started at <http://127.0.0.1:52119> with its API at <http://127.0.0.1:42119>. Use these PowerShell commands in separate terminals after `npm run build` to reproduce that setup:

```powershell
# Terminal 1, from S:\SeatLock
$env:PORT = '42119'
$env:FRONTEND_ORIGIN = 'http://127.0.0.1:52119'
npm run start --prefix backend

# Terminal 2, from S:\SeatLock\frontend
$env:SEATLOCK_API_TARGET = 'http://127.0.0.1:42119'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 52119 --strictPort
```

`GET /api/health` checks the database connection. A database outage returns an error; the API never falls back to in-memory sample data.

### API endpoints

- `GET /api/health` — service and database status.
- `GET /api/movies` — movies with showtimes.
- `GET /api/movies/:id` — one movie with showtimes, or 404.
- `GET /api/showtimes?movieId=afterlight` — showtimes for one movie.
- `GET /api/showtimes/:id/seats` — auditorium and physical seat layout for a showtime, or 404.
- `POST /api/auth/register` — create a user and session; `{name,email,password}`.
- `POST /api/auth/login` — sign in; `{email,password}`.
- `POST /api/auth/logout` — destroy the current session.
- `GET /api/auth/me` — current user, or 401.
- `GET /api/showtimes/:id/availability` — public seat statuses: `available`, `held`, or `booked`.
- `POST /api/holds` — authenticated hold for `{showtimeId,seatIds}` (1–6 seat ID strings).
- `GET /api/holds/:id` — current user's hold and expiry.
- `DELETE /api/holds/:id` — release the current user's hold.
- `POST /api/holds/:id/confirm` — idempotent demo confirmation, with no payment.
- `GET /api/bookings` — current user's booking history.
- `GET /api/bookings/:id` — current user's booking details.

### Booking architecture

```mermaid
flowchart LR
  U[Authenticated user] --> H[seat_holds]
  H --> C[seat_claims: one row per showtime + seat]
  C --> B[bookings]
  B --> BS[booking_seats: unique showtime + seat]
  S[showtimes] --> C
  P[physical seats] --> C
```

`seat_holds` records ownership, expiry, seat count, and a server-calculated unit price. `seat_claims` has a primary key on `(showtime_id, seat_id)`. A hold request runs in one PostgreSQL transaction, checks auditorium membership, sorts seat IDs, and acquires each claim. Its conflict update succeeds only when the previous claim is a hold whose expiry is at or before PostgreSQL `clock_timestamp()`. If any seat conflicts, the transaction rolls back every claim in the group. Expired claims can therefore be reused without a cleanup worker.

Confirmation locks the hold row, checks ownership and database expiry, and creates a booking, booking-seat price snapshots, and permanent booked claims in one transaction. `bookings.hold_id` is unique, making repeat confirmations return the existing booking. `booking_seats` independently enforces unique `(showtime_id, seat_id)` allocations. Foreign keys tie seats and showtimes to the same auditorium. A booked claim cannot be replaced by a hold. Booking references are unique random values. No payment authorization or charge occurs.

The frontend polls availability every eight seconds while selecting seats. A successful hold displays its server-calculated total and a countdown. The database remains authoritative if the client's clock or seat view is stale. Confirmed demo bookings appear in the account dashboard.

### Real-time availability

Socket.IO runs on the existing Express HTTP server. Clients join a validated `showtime:<id>` room with `showtime:join` and leave with `showtime:leave`. The server checks that the showtime exists and accepts connections only from `FRONTEND_ORIGIN`. Clients cannot publish authoritative availability events.

After a successful PostgreSQL commit, the server emits **`availability:changed`** to that showtime room:

```json
{ "showtimeId": "a1", "reason": "hold_created", "changedAt": "2026-11-13T12:00:00.000Z" }
```

`reason` is one of `hold_created`, `hold_released`, or `booking_confirmed`. The event carries no seat ownership, session token, user details, or booking details. It is a notification only: clients refetch `GET /api/showtimes/:id/availability`, and PostgreSQL remains the source of truth. The UI ignores notices for other showtimes and applies only the latest availability response, so duplicate or delayed notices cannot overwrite a newer fetch. Reconnection rejoins the room and refetches immediately. An eight-second poll reconciles missed events and hold expiry, which can occur without a database write or Socket.IO event.

An active hold ID, movie ID, and showtime ID are kept in browser `sessionStorage` solely to reopen the modal after a page refresh; the ID grants no authority without the user's HTTP-only session cookie. On restoration and every ten seconds while held, the UI checks `GET /api/holds/:id`. The countdown uses the backend's `expiresAt` and `serverTime`, disables confirmation at zero, and checks the hold again before confirmation. The backend's transaction makes the final decision if the browser clock or network is stale.

### Session security

Passwords use Argon2id hashes. The browser receives an opaque, random session cookie (`seatlock.sid`) with `HttpOnly`, `SameSite=Lax`, and a seven-day expiry. The cookie has `Secure` set when `NODE_ENV=production`; production must be served over HTTPS. Only a SHA-256 hash of the session token is stored in PostgreSQL, tied to a user and expiry time. Login replaces any presented session, and logout deletes it. No auth token is placed in localStorage.

All auth and booking state-changing routes require an exact `Origin` match with `FRONTEND_ORIGIN` and the `X-SeatLock-Request: 1` header. The frontend sends these through the same-origin Vite proxy. Set `FRONTEND_ORIGIN` to the deployed origin in production. Login is limited to ten attempts per IP per fifteen minutes per server process; use a shared limiter if deploying multiple API instances. Error responses omit hashes and internal details.

### Checks

```sh
npm run typecheck
npm run build
npm run migrate --prefix backend
npm run seed --prefix backend
npm run test:integration --prefix backend
npm run test:auth --prefix backend
npm run test:booking --prefix backend
npm run test:realtime --prefix backend
npm run test:e2e
```

The Edge browser test starts its own SeatLock servers on ports 42117 and 52117, avoiding unrelated services on the usual development ports. It uses isolated movie, showtime, seat, and account fixtures and removes only those fixtures afterward. The test requires the installed Microsoft Edge browser; change `playwright.config.cjs` to another Playwright browser channel if needed. For manual testing: register two accounts in separate browser profiles, open the same showtime, hold a seat in one, confirm the other sees it held, release it, then confirm a demo booking and check both seat views and account history. Refresh while a hold is active to verify restoration, then disconnect and reconnect the network to verify recovery.

In a PostgreSQL-backed test run, two concurrent users produced **one hold and one conflict** for one seat. Twenty parallel hold requests produced **one hold and nineteen conflicts**. Twenty parallel hold-to-confirm workflows produced **one confirmed booking and nineteen conflicts** for one physical seat. Two concurrent confirmations of a multi-seat hold produced **two successful idempotent responses, one booking row, and two booked seat rows**. Real-time tests verified that two clients receive committed hold and release notices, an unrelated room receives none, a reconnecting client refetches booked state, and expiry is visible without an event. The Edge test passed with two independent browser contexts covering registration, live seat changes, release, refresh restoration, confirmation, history, logout/login, and network reconnect. Re-run the commands above on your own database; these are recorded results, not a guarantee for an untested deployment.

Current limitations: bookings are demo confirmations with no payment, cancellation, refunds, or customer notifications. One API instance is supported for Socket.IO; multiple instances would need a distributed adapter (for example Redis) so room notifications reach every instance. Redis is not required for booking correctness. The login rate limiter is process-local. Deploy the frontend and API behind one HTTPS origin and keep PostgreSQL migrations and credentials managed securely.
