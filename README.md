# SeatLock

SeatLock is a portfolio project for exploring a premium movie-ticket booking experience. Phase 2A adds PostgreSQL persistence for movies, showtimes, auditoriums, and physical seat layouts. The seat picker remains a demo; no seat availability, holds, reservations, authentication, or payment processing exist yet.

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

The database is stored in the persistent `seatlock_pgdata` Docker volume. Migrations are numbered SQL files in `backend/migrations`; the runner records applied versions in `schema_migrations` and runs each migration in a transaction. The development seed uses the Phase 1 sample catalog as input, inserts one screen per movie, and adds 40 physical seats per screen. Rerunning it preserves existing rows. Restarting the backend does not erase database rows.

The API runs at <http://127.0.0.1:4000> and the Vite frontend at <http://127.0.0.1:5173>. Use the IPv4 URL if another local service owns the IPv6 `localhost` listener. `GET /api/health` checks the database connection. A database outage returns an error; the API never falls back to in-memory sample data.

### API endpoints

- `GET /api/health` — service and database status.
- `GET /api/movies` — movies with showtimes.
- `GET /api/movies/:id` — one movie with showtimes, or 404.
- `GET /api/showtimes?movieId=afterlight` — showtimes for one movie.
- `GET /api/showtimes/:id/seats` — auditorium and physical seat layout for a showtime, or 404.

### Checks

```sh
npm run typecheck
npm run build
npm run migrate --prefix backend
npm run seed --prefix backend
npm run test:integration --prefix backend
```

The API maps PostgreSQL rows into the Phase 1 frontend response shape. Seat selection uses the returned layout but does not store or confirm a booking. Future work can add reservation tables and transaction rules without changing the physical seat identities.
