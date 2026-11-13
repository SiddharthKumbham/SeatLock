ALTER TABLE seats ADD CONSTRAINT seats_id_auditorium_unique UNIQUE (id, auditorium_id);
ALTER TABLE showtimes ADD CONSTRAINT showtimes_id_auditorium_unique UNIQUE (id, auditorium_id);

CREATE TABLE seat_holds (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  showtime_id text NOT NULL,
  auditorium_id bigint NOT NULL,
  seat_count integer NOT NULL CHECK (seat_count BETWEEN 1 AND 6),
  unit_price numeric(10,2) NOT NULL CHECK (unit_price >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','confirmed')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, showtime_id),
  FOREIGN KEY (showtime_id, auditorium_id) REFERENCES showtimes(id, auditorium_id) ON DELETE RESTRICT
);
CREATE INDEX seat_holds_user_created_idx ON seat_holds(user_id, created_at DESC);
CREATE INDEX seat_holds_expiry_idx ON seat_holds(expires_at) WHERE status = 'active';

CREATE TABLE bookings (
  id uuid PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  hold_id uuid NOT NULL UNIQUE REFERENCES seat_holds(id) ON DELETE RESTRICT,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  showtime_id text NOT NULL,
  auditorium_id bigint NOT NULL,
  total_price numeric(10,2) NOT NULL CHECK (total_price >= 0),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, showtime_id),
  FOREIGN KEY (showtime_id, auditorium_id) REFERENCES showtimes(id, auditorium_id) ON DELETE RESTRICT
);
CREATE INDEX bookings_user_confirmed_idx ON bookings(user_id, confirmed_at DESC);

CREATE TABLE seat_claims (
  showtime_id text NOT NULL,
  auditorium_id bigint NOT NULL,
  seat_id bigint NOT NULL,
  state text NOT NULL CHECK (state IN ('held','booked')),
  hold_id uuid,
  booking_id uuid,
  expires_at timestamptz,
  PRIMARY KEY (showtime_id, seat_id),
  FOREIGN KEY (showtime_id, auditorium_id) REFERENCES showtimes(id, auditorium_id) ON DELETE RESTRICT,
  FOREIGN KEY (seat_id, auditorium_id) REFERENCES seats(id, auditorium_id) ON DELETE RESTRICT,
  FOREIGN KEY (hold_id, showtime_id) REFERENCES seat_holds(id, showtime_id) ON DELETE RESTRICT,
  FOREIGN KEY (booking_id, showtime_id) REFERENCES bookings(id, showtime_id) ON DELETE RESTRICT,
  CONSTRAINT claim_state_consistent CHECK (
    (state='held' AND hold_id IS NOT NULL AND booking_id IS NULL AND expires_at IS NOT NULL)
    OR (state='booked' AND hold_id IS NULL AND booking_id IS NOT NULL AND expires_at IS NULL)
  )
);
CREATE INDEX seat_claims_hold_idx ON seat_claims(hold_id) WHERE state='held';

CREATE TABLE booking_seats (
  booking_id uuid NOT NULL,
  showtime_id text NOT NULL,
  auditorium_id bigint NOT NULL,
  seat_id bigint NOT NULL,
  price_paid numeric(10,2) NOT NULL CHECK (price_paid >= 0),
  PRIMARY KEY (booking_id, seat_id),
  UNIQUE (showtime_id, seat_id),
  FOREIGN KEY (booking_id, showtime_id) REFERENCES bookings(id, showtime_id) ON DELETE RESTRICT,
  FOREIGN KEY (seat_id, auditorium_id) REFERENCES seats(id, auditorium_id) ON DELETE RESTRICT,
  FOREIGN KEY (showtime_id, auditorium_id) REFERENCES showtimes(id, auditorium_id) ON DELETE RESTRICT
);
