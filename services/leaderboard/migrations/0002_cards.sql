-- evidence: the card image is the only fact that never changes. every read of
-- it is a separate row per parser version, so re-reading never overwrites.

CREATE TABLE cards (
  id                  TEXT PRIMARY KEY,
  link_hash           TEXT NOT NULL UNIQUE,             -- hmac of the normalized kuro link; the link is never stored
  image_sha256        TEXT NOT NULL,
  r2_key              TEXT NOT NULL,                    -- cards/<sha256>.<ext> in the private CARDS bucket
  content_type        TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  byte_size           INTEGER NOT NULL,
  kuro_last_modified  INTEGER NOT NULL,
  fetched_at          INTEGER NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'read', 'rejected', 'blocked')),
  reject_reason       TEXT,
  current_read_id     TEXT                              -- card_reads.id; no fk (circular)
);
CREATE INDEX cards_image ON cards (image_sha256);
CREATE INDEX cards_status ON cards (status, fetched_at);

CREATE TABLE card_reads (
  id             TEXT PRIMARY KEY,
  card_id        TEXT NOT NULL REFERENCES cards (id),
  parser_ver     TEXT NOT NULL,
  uid            TEXT,                                  -- null unless every digit read exactly
  resonator_id   TEXT,
  snapshot       TEXT,                                  -- BuildSnapshot json; null when the read failed
  confidence     TEXT,                                  -- per-field confidence json, for review
  outcome        TEXT NOT NULL CHECK (outcome IN ('ok', 'uid_unreadable', 'unreadable', 'unsupported')),
  created_at     INTEGER NOT NULL,
  UNIQUE (card_id, parser_ver)
);
CREATE INDEX card_reads_uid ON card_reads (uid);
