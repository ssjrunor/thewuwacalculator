-- builds: a uid's entry for one resonator, pointing at one read. owned by the
-- uid, never by an account. one active build per uid and resonator is enforced
-- by the partial unique index, which also removes the need to dedupe boards.
-- a card shows a build the player had, not necessarily the current one (kuro
-- keeps every card it drew). anonymous submissions may only replace the active
-- build with one first drawn later; the owner, with a session, may pick any.

CREATE TABLE builds (
  id             TEXT PRIMARY KEY,
  uid            TEXT NOT NULL REFERENCES players (uid),
  resonator_id   TEXT NOT NULL,
  card_id        TEXT NOT NULL REFERENCES cards (id),
  read_id        TEXT NOT NULL REFERENCES card_reads (id),
  sequence       INTEGER NOT NULL CHECK (sequence BETWEEN 0 AND 6),
  drawn_at       INTEGER NOT NULL,                      -- card first drawn (cards.kuro_last_modified)
  activated_by   TEXT CHECK (activated_by IN ('submission', 'owner')),
  snapshot_hash  TEXT NOT NULL,                         -- identical rebuilds only bump last_seen_at
  state          TEXT NOT NULL CHECK (state IN ('active', 'replaced', 'deleted', 'hidden')),
  replaced_by    TEXT REFERENCES builds (id),
  created_at     INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  ended_at       INTEGER
);
CREATE UNIQUE INDEX builds_one_active ON builds (uid, resonator_id) WHERE state = 'active';
CREATE INDEX builds_resonator ON builds (resonator_id, state);
CREATE INDEX builds_owner ON builds (uid, resonator_id, drawn_at DESC);
CREATE INDEX builds_card ON builds (card_id);
