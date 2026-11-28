-- Author: Runor Ewhro
-- description: the leaderboard's global database. each resonator's builds, scores, jobs and ranks are stored in its
--              own Durable Object (src/board/), and cards in sixteen registry shards (src/cards/). this database
--              stores the small per-player and per-account data: identity, accounts, social, moderation, documents,
--              the ruleset catalog, and projections the boards write through their outbox (src/api/projections.ts).
--              conventions: text ids (uuidv7) for rows created here; builds are referenced by public id
--              '<resonator>-<local base36>' and cards by '<shard hex>-<no base36>'; a uid is its nine digits as text
--              (seeded uids start with 0). times are integer epoch milliseconds, enums are text with CHECK, json is
--              stored as text

-- identity

CREATE TABLE players (
  uid            TEXT PRIMARY KEY,
  region         TEXT,                                   -- the uid's first digit (the server)
  last_name      TEXT,                                   -- player name from the latest card
  hide_uid       INTEGER NOT NULL DEFAULT 0 CHECK (hide_uid IN (0, 1)),
  -- set by the player's own choice: shown as Anonymous with their region
  anonymous      INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  -- set for a uid whose builds were seeded before its player took part: shown as anonymous until the player
  -- first acts for it (a submission or a fresh-card login)
  setup_at       INTEGER,
  opted_out_at   INTEGER,                                -- null while participating
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  seed_batch     TEXT REFERENCES seed_batches (id),
  -- incremented with every change the boards read (hide_uid, anonymous, setup, opt-out, a ban); boards store the
  -- newest copy they receive (BoardDO.syncPlayer)
  ver            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX players_region ON players (region);
CREATE INDEX players_seed_batch ON players (seed_batch) WHERE seed_batch IS NOT NULL;

CREATE TABLE claims (
  id             TEXT PRIMARY KEY,
  uid            TEXT NOT NULL REFERENCES players (uid),
  card_id        TEXT NOT NULL,                          -- the registry card that proved the claim
  kind           TEXT NOT NULL CHECK (kind IN ('fresh_card')),
  created_at     INTEGER NOT NULL
);
CREATE INDEX claims_uid ON claims (uid, created_at);

-- a claim session (no account) acts for the uids it holds, an account session for the account's linked uids
CREATE TABLE sessions (
  token_hash     TEXT PRIMARY KEY,                       -- the session-keyed hmac of the cookie token
  account_id     TEXT,                                   -- the signed-in account; null for a claim session
  claim_id       TEXT REFERENCES claims (id),            -- the fresh card a claim session started with
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  revoked_at     INTEGER
);
CREATE INDEX sessions_expiry ON sessions (expires_at);
CREATE INDEX sessions_account ON sessions (account_id);

-- fresh-card proofs of claim sessions; account sessions hold no uids
CREATE TABLE uid_holds (
  uid            TEXT PRIMARY KEY REFERENCES players (uid),
  token_hash     TEXT NOT NULL REFERENCES sessions (token_hash) ON DELETE CASCADE,
  claim_id       TEXT NOT NULL REFERENCES claims (id),
  created_at     INTEGER NOT NULL
);
CREATE INDEX uid_holds_session ON uid_holds (token_hash);

CREATE TABLE accounts (
  id             TEXT PRIMARY KEY,
  role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  created_at     INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  feed_seen_at   INTEGER,
  seed_batch     TEXT REFERENCES seed_batches (id)
);
CREATE INDEX accounts_seed_batch ON accounts (seed_batch) WHERE seed_batch IS NOT NULL;

CREATE TABLE account_logins (
  provider       TEXT NOT NULL CHECK (provider IN ('discord', 'google')),
  subject        TEXT NOT NULL,
  account_id     TEXT NOT NULL REFERENCES accounts (id),
  created_at     INTEGER NOT NULL,
  last_used_at   INTEGER NOT NULL,
  profile        TEXT,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX account_logins_account ON account_logins (account_id);

CREATE TABLE account_uids (
  uid            TEXT PRIMARY KEY REFERENCES players (uid),
  account_id     TEXT NOT NULL REFERENCES accounts (id),
  claim_id       TEXT NOT NULL REFERENCES claims (id),
  linked_at      INTEGER NOT NULL
);
CREATE INDEX account_uids_account ON account_uids (account_id);

CREATE TABLE oauth_states (
  state_hash     TEXT PRIMARY KEY,
  provider       TEXT NOT NULL,
  verifier       TEXT NOT NULL,
  return_to      TEXT NOT NULL,
  token_hash     TEXT,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL
);
CREATE INDEX oauth_states_expiry ON oauth_states (expires_at);

-- social

CREATE TABLE follows (
  account_id     TEXT NOT NULL REFERENCES accounts (id),
  kind           TEXT NOT NULL CHECK (kind IN ('player', 'board')),
  target         TEXT NOT NULL,                          -- a uid or a resonator id
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (account_id, kind, target)
) WITHOUT ROWID;
CREATE INDEX follows_target ON follows (kind, target);

CREATE TABLE bookmarks (
  account_id     TEXT NOT NULL REFERENCES accounts (id),
  build_id       TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (account_id, build_id)
) WITHOUT ROWID;
CREATE INDEX bookmarks_build ON bookmarks (build_id);

-- blocks between people (accounts), covering every uid of the blocked account
CREATE TABLE blocks (
  id               TEXT PRIMARY KEY,                     -- lifts the block, even with no other reference to the blocked person
  account_id       TEXT NOT NULL REFERENCES accounts (id),
  blocked_account  TEXT NOT NULL REFERENCES accounts (id),
  created_at       INTEGER NOT NULL,
  UNIQUE (account_id, blocked_account)
);
CREATE INDEX blocks_blocked ON blocks (blocked_account);

CREATE TABLE notifications (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL REFERENCES accounts (id),
  kind           TEXT NOT NULL CHECK (kind IN ('sanction', 'media', 'scored', 'dethroned', 'appeal', 'uid_moved')),
  subject_id     TEXT NOT NULL,
  build_id       TEXT,
  actor_uid      TEXT,
  count          INTEGER NOT NULL DEFAULT 1,
  data           TEXT,
  created_at     INTEGER NOT NULL,
  read_at        INTEGER
);
CREATE INDEX notifications_account ON notifications (account_id, created_at);
CREATE INDEX notifications_build ON notifications (build_id) WHERE build_id IS NOT NULL;
CREATE UNIQUE INDEX notifications_gather ON notifications (account_id, kind, subject_id) WHERE read_at IS NULL;
CREATE INDEX notifications_created ON notifications (created_at);
CREATE INDEX notifications_read ON notifications (read_at) WHERE read_at IS NOT NULL;

-- documents, media, presets

CREATE TABLE documents (
  kind           TEXT NOT NULL CHECK (kind IN ('profile', 'card', 'views')),
  owner_id       TEXT NOT NULL,                          -- an account id (profile, views), or account:resonator (card)
  schema_ver     INTEGER NOT NULL,
  body           TEXT NOT NULL,
  updated_at     INTEGER NOT NULL,
  reviewed_at    INTEGER,
  reviewed_by    TEXT,
  PRIMARY KEY (kind, owner_id)
);
CREATE INDEX documents_review ON documents (reviewed_at, updated_at);

CREATE TABLE media (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL REFERENCES accounts (id),
  purpose        TEXT NOT NULL CHECK (purpose IN ('avatar', 'banner', 'card')),
  r2_key         TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  sha256         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'deleted')),
  created_at     INTEGER NOT NULL,
  reviewed_at    INTEGER,
  reviewed_by    TEXT
);
CREATE INDEX media_account ON media (account_id, created_at);
CREATE INDEX media_review ON media (status, created_at);

CREATE TABLE card_presets (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL REFERENCES accounts (id),
  name           TEXT NOT NULL,
  style          TEXT NOT NULL,
  shared         INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX card_presets_account ON card_presets (account_id, updated_at);

-- moderation

CREATE TABLE reports (
  id               TEXT PRIMARY KEY,
  build_id         TEXT NOT NULL,
  -- the uid of the reported build's owner, for reading a player's reports without their boards
  subject_uid      TEXT,
  reason           TEXT NOT NULL CHECK (reason IN ('misread', 'not_owner', 'abuse', 'other')),
  details          TEXT,
  reporter_account TEXT,                                 -- null for a signed-out report
  status           TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution       TEXT,
  created_at       INTEGER NOT NULL,
  resolved_at      INTEGER,
  assigned_to      TEXT,
  assigned_at      INTEGER
);
CREATE INDEX reports_open ON reports (status, created_at);
CREATE INDEX reports_build ON reports (build_id);
CREATE INDEX reports_subject ON reports (subject_uid, created_at);

CREATE TABLE report_notes (
  id             TEXT PRIMARY KEY,
  report_id      TEXT NOT NULL REFERENCES reports (id),
  author         TEXT NOT NULL,
  body           TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX report_notes_report ON report_notes (report_id, created_at);

CREATE TABLE sanctions (
  id             TEXT PRIMARY KEY,
  subject_kind   TEXT NOT NULL CHECK (subject_kind IN ('uid', 'account')),
  subject_id     TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('warn', 'mute', 'suspend', 'ban')),
  reason         TEXT NOT NULL,
  report_id      TEXT REFERENCES reports (id),
  issued_by      TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER,
  lifted_at      INTEGER,
  lifted_by      TEXT,
  CHECK (kind <> 'suspend' OR expires_at IS NOT NULL),
  CHECK (kind NOT IN ('warn', 'ban') OR expires_at IS NULL)
);
CREATE INDEX sanctions_subject ON sanctions (subject_kind, subject_id, created_at);

CREATE TABLE appeals (
  id             TEXT PRIMARY KEY,
  sanction_id    TEXT NOT NULL REFERENCES sanctions (id),
  account_id     TEXT NOT NULL REFERENCES accounts (id),
  body           TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('open', 'upheld', 'granted')),
  response       TEXT,
  created_at     INTEGER NOT NULL,
  decided_at     INTEGER,
  decided_by     TEXT
);
CREATE UNIQUE INDEX appeals_one_open ON appeals (sanction_id) WHERE status = 'open';
CREATE INDEX appeals_status ON appeals (status, created_at);

-- staff and account actions; a build's lifecycle events are stored on its board and a card's on its registry shard
CREATE TABLE audit_log (
  id             TEXT PRIMARY KEY,
  at             INTEGER NOT NULL,
  actor_kind     TEXT NOT NULL CHECK (actor_kind IN ('uid', 'account', 'admin', 'system')),
  actor_id       TEXT,
  action         TEXT NOT NULL,
  subject_kind   TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  data           TEXT
);
CREATE INDEX audit_actor ON audit_log (actor_kind, actor_id, at);
CREATE INDEX audit_subject ON audit_log (subject_kind, subject_id, at);

CREATE VIEW banned_uids AS SELECT DISTINCT subject_id AS uid FROM sanctions
  WHERE subject_kind = 'uid' AND kind = 'ban' AND lifted_at IS NULL;
CREATE VIEW listed_players AS SELECT * FROM players
  WHERE opted_out_at IS NULL AND uid NOT IN (SELECT uid FROM banned_uids);

-- rulesets

CREATE TABLE settings (
  key            TEXT PRIMARY KEY,                       -- 'live_ruleset'
  value          TEXT NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE rulesets (
  id             TEXT PRIMARY KEY,                       -- e.g. '2026-11a'
  -- the ruleset's number on the boards (their per-ruleset tables are s<no>, e<no>, ...), never reused
  no             INTEGER NOT NULL UNIQUE,
  game_ver       TEXT NOT NULL,
  engine_ver     TEXT NOT NULL,
  rotation_ver   TEXT NOT NULL,
  manifest_key   TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('building', 'live', 'archived')),
  created_at     INTEGER NOT NULL,
  live_at        INTEGER,
  archived_at    INTEGER,
  fingerprint    TEXT,
  scorer         TEXT,
  -- the scorer hash in two parts (tools/lib/fingerprint.mjs scorerParts): the generator (src/engine/rotationGen) and
  -- the rest of the scoring code (evaluation). a rollout whose scorer differs only in its generator reuses each score
  -- with an unchanged program (board/BoardDO.ts cellsOf, scorer/reuse.ts)
  generator_fp   TEXT,
  evaluation_fp  TEXT
);

-- a ruleset's scenarios, numbered per resonator; a board cell is (rs, cell)
CREATE TABLE scenarios (
  id             TEXT PRIMARY KEY,                       -- '<ruleset>:<resonator>:<team>:<weapon>'
  rs             INTEGER NOT NULL,
  ruleset_id     TEXT NOT NULL REFERENCES rulesets (id),
  resonator_id   TEXT NOT NULL,
  cell           INTEGER NOT NULL,
  team_id        TEXT NOT NULL,
  recipe_sha256  TEXT NOT NULL,
  team_key       TEXT NOT NULL,
  team_rank      INTEGER NOT NULL,
  weapon_id      TEXT NOT NULL,
  weapon_rank    INTEGER NOT NULL,
  weapon_role    TEXT NOT NULL CHECK (weapon_role IN ('signature', 'primary', 'alternative', 'standard')),
  members        TEXT NOT NULL,                          -- json: member resonator ids in slot order
  fingerprint    TEXT,
  data_fingerprint TEXT,
  UNIQUE (rs, resonator_id, cell)
);
CREATE INDEX scenarios_lookup ON scenarios (ruleset_id, resonator_id);

CREATE TABLE rollouts (
  ruleset_id     TEXT PRIMARY KEY REFERENCES rulesets (id),
  from_ruleset   TEXT REFERENCES rulesets (id),
  status         TEXT NOT NULL CHECK (status IN ('scoring', 'done', 'cancelled')),
  keep           TEXT NOT NULL DEFAULT 'scenario' CHECK (keep IN ('scenario', 'data', 'none')),
  boards         INTEGER NOT NULL DEFAULT 0,             -- number of boards it started on
  started_by     TEXT NOT NULL,
  started_at     INTEGER NOT NULL,
  live_at        INTEGER,
  finished_at    INTEGER
);

CREATE TABLE ruleset_checks (
  ruleset_id     TEXT NOT NULL REFERENCES rulesets (id),
  from_ruleset   TEXT NOT NULL REFERENCES rulesets (id),
  scorer         TEXT NOT NULL,
  samples        INTEGER NOT NULL,
  differing      INTEGER NOT NULL,
  checked_by     TEXT NOT NULL,
  checked_at     INTEGER NOT NULL,
  PRIMARY KEY (ruleset_id, from_ruleset)
);

-- a sample check's result per scenario (moderation/checks.ts): the number of the scenario's stored live-ruleset
-- scores the new ruleset's scorer rescored and the number that differed. a rollout with a new scorer reuses old
-- scores only on scenarios where every sample matched (BoardDO.cellsOf); ruleset_checks stores the totals
CREATE TABLE ruleset_check_scenarios (
  ruleset_id     TEXT NOT NULL REFERENCES rulesets (id),
  from_ruleset   TEXT NOT NULL REFERENCES rulesets (id),
  -- the scenario id without its ruleset prefix: '<resonator>:<team>:<weapon>'
  key            TEXT NOT NULL,
  scorer         TEXT NOT NULL,
  samples        INTEGER NOT NULL,
  differing      INTEGER NOT NULL,
  checked_at     INTEGER NOT NULL,
  PRIMARY KEY (ruleset_id, from_ruleset, key)
) WITHOUT ROWID;

-- test data

CREATE TABLE seed_batches (
  id             TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('scored', 'written')),
  created_at     INTEGER NOT NULL,
  players        INTEGER NOT NULL DEFAULT 0,
  accounts       INTEGER NOT NULL DEFAULT 0,
  builds         INTEGER NOT NULL DEFAULT 0,
  uid_from       TEXT,
  uid_to         TEXT,
  -- each batch takes a range of build locals shared by every board (src/api/moderation/seed.ts), so a board drops a
  -- batch by range; purged_boards is a json list of the boards a purge has finished
  local_from     INTEGER,
  local_to       INTEGER,
  purged_boards  TEXT
);

-- projections, written only from the boards' outboxes (src/api/projections.ts)

-- each board's live summary: its size and the builds at #1
CREATE TABLE boards (
  resonator_id   TEXT PRIMARY KEY,
  ruleset_id     TEXT NOT NULL,
  total          INTEGER NOT NULL,
  top            TEXT NOT NULL,                          -- json: public ids of the builds tied at #1
  top_score      REAL,
  updated_at     INTEGER NOT NULL,
  -- the board's first row (src/board/types.ts HeadRow, json), written with its summary, so the boards index reads D1
  -- alone; null until the board's next write sends it
  head           TEXT
);

-- a player's standing on each board with their builds, read by profiles, history and social
CREATE TABLE player_boards (
  uid            TEXT NOT NULL,
  resonator_id   TEXT NOT NULL,
  standing       INTEGER NOT NULL,                       -- kept build count
  active         TEXT,                                   -- public id of the ranked build
  listed         TEXT,                                   -- the same id, while the build shows on the board
  listed_at      INTEGER,
  sequence       INTEGER,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (uid, resonator_id)
) WITHOUT ROWID;
CREATE INDEX player_boards_listed ON player_boards (resonator_id, listed_at) WHERE listed IS NOT NULL;
CREATE INDEX player_boards_active ON player_boards (active) WHERE active IS NOT NULL;

-- recent uploads for the activity page and follow feeds, pruned after 90 days
CREATE TABLE recent_uploads (
  build_id       TEXT PRIMARY KEY,
  uid            TEXT NOT NULL,
  resonator_id   TEXT NOT NULL,
  at             INTEGER NOT NULL,
  shown          INTEGER NOT NULL CHECK (shown IN (0, 1))
);
CREATE INDEX recent_uploads_at ON recent_uploads (at) WHERE shown = 1;
CREATE INDEX recent_uploads_uid ON recent_uploads (uid, at);
CREATE INDEX recent_uploads_board ON recent_uploads (resonator_id, at) WHERE shown = 1;
CREATE INDEX recent_uploads_age ON recent_uploads (at);

-- shown uploads counted per 15 minutes for the activity strip, because counting recent_uploads on each read covers
-- every upload of the strip's 16 days. triggers update it with every writer (projections, seeds, purges, pruning),
-- and slots are retained as long as the uploads they count (90 days), so a deleted upload always finds its slot
CREATE TABLE upload_slots (
  q        INTEGER PRIMARY KEY,
  entries  INTEGER NOT NULL
);

CREATE TRIGGER recent_uploads_slot_in AFTER INSERT ON recent_uploads WHEN NEW.shown = 1
BEGIN
  INSERT INTO upload_slots (q, entries) VALUES (NEW.at / 900000, 1)
    ON CONFLICT (q) DO UPDATE SET entries = entries + 1;
END;

CREATE TRIGGER recent_uploads_slot_out AFTER DELETE ON recent_uploads WHEN OLD.shown = 1
BEGIN
  UPDATE upload_slots SET entries = entries - 1 WHERE q = OLD.at / 900000;
END;

CREATE TRIGGER recent_uploads_slot_move AFTER UPDATE OF at, shown ON recent_uploads
  WHEN OLD.shown <> NEW.shown OR (NEW.shown = 1 AND OLD.at / 900000 <> NEW.at / 900000)
BEGIN
  UPDATE upload_slots SET entries = entries - 1 WHERE OLD.shown = 1 AND q = OLD.at / 900000;
  INSERT INTO upload_slots (q, entries) SELECT NEW.at / 900000, 1 WHERE NEW.shown = 1
    ON CONFLICT (q) DO UPDATE SET entries = entries + 1;
END;

-- applied outbox batches, so a resent batch applies once
CREATE TABLE board_sync (
  resonator_id   TEXT NOT NULL,
  first_seq      INTEGER NOT NULL,
  last_seq       INTEGER NOT NULL,
  at             INTEGER NOT NULL,
  PRIMARY KEY (resonator_id, first_seq)
) WITHOUT ROWID;
CREATE INDEX board_sync_at ON board_sync (at);
