-- moderation and history. reports come from anyone (rate limited); the audit
-- log is append-only and records every write that matters, by any actor.

CREATE TABLE reports (
  id               TEXT PRIMARY KEY,
  build_id         TEXT NOT NULL REFERENCES builds (id),
  reason           TEXT NOT NULL CHECK (reason IN ('misread', 'not_owner', 'abuse', 'other')),
  details          TEXT,
  reporter_uid     TEXT,
  reporter_account TEXT,
  status           TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution       TEXT,
  created_at       INTEGER NOT NULL,
  resolved_at      INTEGER
);
CREATE INDEX reports_open ON reports (status, created_at);

CREATE TABLE audit_log (
  id             TEXT PRIMARY KEY,
  at             INTEGER NOT NULL,
  actor_kind     TEXT NOT NULL CHECK (actor_kind IN ('uid', 'account', 'admin', 'system')),
  actor_id       TEXT,
  action         TEXT NOT NULL,                         -- e.g. 'build.delete', 'player.opt_out'
  subject_kind   TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  data           TEXT                                   -- json
);
CREATE INDEX audit_subject ON audit_log (subject_kind, subject_id, at);
