-- Author: Runor Ewhro
-- description: a report can be about a card that made no build: the reader refused it for its uid alone, and staff
--              read the uid off the image (POST /admin/cards/:id/uid). its build_id is filled in once that places the
--              build. sqlite has no in-place NOT NULL change, so the table is copied; report_notes and sanctions
--              reference it by id, which the copy preserves
PRAGMA defer_foreign_keys = true;

CREATE TABLE reports_next (
  id               TEXT PRIMARY KEY,
  build_id         TEXT,                                 -- null while a card report's build is not placed
  card_id          TEXT,                                 -- set for a report the reader filed about a refused card
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
  assigned_at      INTEGER,
  CHECK (build_id IS NOT NULL OR card_id IS NOT NULL)
);
INSERT INTO reports_next (id, build_id, card_id, subject_uid, reason, details, reporter_account, status, resolution,
    created_at, resolved_at, assigned_to, assigned_at)
  SELECT id, build_id, NULL, subject_uid, reason, details, reporter_account, status, resolution, created_at, resolved_at,
    assigned_to, assigned_at FROM reports;
DROP TABLE reports;
ALTER TABLE reports_next RENAME TO reports;
CREATE INDEX reports_open ON reports (status, created_at);
CREATE INDEX reports_build ON reports (build_id);
CREATE INDEX reports_subject ON reports (subject_uid, created_at);
CREATE INDEX reports_card ON reports (card_id) WHERE card_id IS NOT NULL;
