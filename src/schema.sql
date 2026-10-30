-- Films on Cue database schema.
-- Safe to run on every start: everything uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS media (
  id          SERIAL PRIMARY KEY,
  mime        TEXT NOT NULL,
  width       INT,
  height      INT,
  data        BYTEA NOT NULL,
  data_small  BYTEA,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id               SERIAL PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  release_year     INT,
  director         TEXT,
  certificate      TEXT,
  runtime_minutes  INT,
  genres           TEXT[] NOT NULL DEFAULT '{}',
  rating           NUMERIC(2,1) NOT NULL CHECK (rating >= 0.5 AND rating <= 5),
  excerpt          TEXT NOT NULL DEFAULT '',
  body_html        TEXT NOT NULL DEFAULT '',
  image_id         INT REFERENCES media(id) ON DELETE SET NULL,
  image_alt        TEXT,
  image_credit     TEXT,
  trailer_url      TEXT,
  watch_where      TEXT,
  watch_detail     TEXT,
  has_spoilers     BOOLEAN NOT NULL DEFAULT false,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at     TIMESTAMPTZ,
  promoted         BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_live_idx ON reviews (status, published_at DESC);

CREATE TABLE IF NOT EXISTS subscribers (
  id               SERIAL PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'unsubscribed')),
  token            TEXT NOT NULL UNIQUE,
  consent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at     TIMESTAMPTZ,
  unsubscribed_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT NOT NULL,
  message     TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per weekly digest; the unique week stops two servers sending the same week twice.
CREATE TABLE IF NOT EXISTS digests (
  id          SERIAL PRIMARY KEY,
  week_key    TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'sending',
  review_ids  INT[] NOT NULL DEFAULT '{}',
  recipients  INT NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS session (
  sid     VARCHAR NOT NULL PRIMARY KEY,
  sess    JSON NOT NULL,
  expire  TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);
