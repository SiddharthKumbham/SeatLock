# SeatLock

SeatLock is a portfolio project for exploring a premium movie-ticket booking experience. Phase 2B adds user accounts and persistent authentication sessions. Movies, showtimes, auditoriums, and physical seat layouts live in PostgreSQL. The seat picker remains a demo; no seat availability, holds, reservations, or payments exist yet.

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

The database is stored in the persistent `seatlock_pgdata` Docker volume. Migrations are numbered SQL files in `backend/migrations`; the runner records applied versions in `schema_migrations` and runs each migration in a transaction. Migration 002 adds `auth_sessions`. The development seed uses the Phase 1 sample catalog as input, inserts one screen per movie, and adds 40 physical seats per screen. Rerunning it preserves existing rows. Restarting the backend does not erase database rows.

The API runs at <http://127.0.0.1:4000> and the Vite frontend at <http://127.0.0.1:5173>. Use the IPv4 URL if another local service owns the IPv6 `localhost` listener. `GET /api/health` checks the database connection. A database outage returns an error; the API never falls back to in-memory sample data.

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

### Session security

Passwords use Argon2id hashes. The browser receives an opaque, random session cookie (`seatlock.sid`) with `HttpOnly`, `SameSite=Lax`, and a seven-day expiry. The cookie has `Secure` set when `NODE_ENV=production`; production must be served over HTTPS. Only a SHA-256 hash of the session token is stored in PostgreSQL, tied to a user and expiry time. Login replaces any presented session, and logout deletes it. No auth token is placed in localStorage.

All auth POST routes require an exact `Origin` match with `FRONTEND_ORIGIN` and the `X-SeatLock-Request: 1` header. The frontend sends these through the same-origin Vite proxy. Set `FRONTEND_ORIGIN` to the deployed origin in production. Login is limited to ten attempts per IP per fifteen minutes per server process; use a shared limiter if deploying multiple API instances. Error responses omit hashes and internal details.

### Checks

```sh
npm run typecheck
npm run build
npm run migrate --prefix backend
npm run seed --prefix backend
npm run test:integration --prefix backend
npm run test:auth --prefix backend
```

The API maps PostgreSQL rows into the Phase 1 frontend response shape. Seat selection uses the returned layout but does not store or confirm a booking. Future work can add reservation tables and transaction rules without changing the physical seat identities.
