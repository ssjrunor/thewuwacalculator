-- identity: a uid is the account. claims record each proof of current control
-- (a fresh card), and sessions are short-lived logins bound to a claim.
-- conventions: text ids (uuidv7), integer epoch milliseconds, text enums with
-- CHECK, json stored as text. standard sql only, so this ports to postgres.

CREATE TABLE players (
  uid            TEXT PRIMARY KEY,
  region         TEXT,                                  -- the uid's first digit (the server)
  last_name      TEXT,                                  -- player name from the latest card
  hide_uid       INTEGER NOT NULL DEFAULT 0 CHECK (hide_uid IN (0, 1)),
  opted_out_at   INTEGER,                               -- null = participating
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL
);
CREATE INDEX players_region ON players (region);

CREATE TABLE claims (
  id             TEXT PRIMARY KEY,
  uid            TEXT NOT NULL REFERENCES players (uid),
  card_id        TEXT NOT NULL,                         -- references cards (created in 0002)
  kind           TEXT NOT NULL CHECK (kind IN ('fresh_card')),
  created_at     INTEGER NOT NULL
);
CREATE INDEX claims_uid ON claims (uid, created_at);

CREATE TABLE sessions (
  token_hash     TEXT PRIMARY KEY,                      -- sha-256 of the cookie token
  uid            TEXT REFERENCES players (uid),         -- set for a card login
  account_id     TEXT,                                  -- set for an account login (later)
  claim_id       TEXT REFERENCES claims (id),
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  revoked_at     INTEGER,
  CHECK (uid IS NOT NULL OR account_id IS NOT NULL)
);
CREATE INDEX sessions_expiry ON sessions (expires_at);
