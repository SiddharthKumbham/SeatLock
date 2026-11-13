CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 0)
);
CREATE UNIQUE INDEX users_email_case_insensitive ON users (lower(email));

CREATE TABLE movies (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  genre text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  poster_url text NOT NULL,
  rating text NOT NULL,
  accent text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auditoriums (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seats (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auditorium_id bigint NOT NULL REFERENCES auditoriums(id) ON DELETE RESTRICT,
  row_label text NOT NULL,
  seat_number integer NOT NULL CHECK (seat_number > 0),
  CONSTRAINT seats_position_unique UNIQUE (auditorium_id, row_label, seat_number),
  CONSTRAINT seats_row_not_blank CHECK (length(trim(row_label)) > 0)
);

CREATE TABLE showtimes (
  id text PRIMARY KEY,
  movie_id text NOT NULL REFERENCES movies(id) ON DELETE RESTRICT,
  auditorium_id bigint NOT NULL REFERENCES auditoriums(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  base_price numeric(10,2) NOT NULL CHECK (base_price >= 0),
  format text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showtimes_auditorium_start_unique UNIQUE (auditorium_id, starts_at)
);
CREATE INDEX showtimes_movie_start_idx ON showtimes (movie_id, starts_at);
CREATE INDEX showtimes_auditorium_start_idx ON showtimes (auditorium_id, starts_at);
