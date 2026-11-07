-- scores: derived and disposable. one row per build per scenario; the scenario
-- fixes the ruleset. score_jobs counts finished scenarios so the last one can
-- write the board entry. board_entries holds the main board per ruleset.

CREATE TABLE build_scores (
  build_id       TEXT NOT NULL REFERENCES builds (id),
  scenario_id    TEXT NOT NULL REFERENCES scenarios (id),
  status         TEXT NOT NULL CHECK (status IN ('ok', 'unsupported', 'error')),
  damage         REAL,                                  -- null unless ok
  duration       REAL,                                  -- seconds of the generated rotation
  dps            REAL,
  score          REAL,                                  -- percent; 100 = benchmark, 200 = perfect
  flags          INTEGER NOT NULL DEFAULT 0,
  program_sha256 TEXT,                                  -- LB_DATA rotations/<sha256>.json
  error          TEXT,
  scored_at      INTEGER NOT NULL,
  PRIMARY KEY (build_id, scenario_id),
  CHECK (status <> 'ok' OR (damage IS NOT NULL AND duration IS NOT NULL AND dps IS NOT NULL AND score IS NOT NULL))
);
CREATE INDEX build_scores_board ON build_scores (scenario_id, score DESC);

CREATE TABLE score_jobs (
  build_id       TEXT NOT NULL REFERENCES builds (id),
  ruleset_id     TEXT NOT NULL REFERENCES rulesets (id),
  expected       INTEGER NOT NULL,
  done           INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL CHECK (status IN ('scoring', 'scored', 'failed')),
  created_at     INTEGER NOT NULL,
  finished_at    INTEGER,
  PRIMARY KEY (build_id, ruleset_id)
);
CREATE INDEX score_jobs_open ON score_jobs (ruleset_id, status);

CREATE TABLE board_entries (
  ruleset_id     TEXT NOT NULL REFERENCES rulesets (id),
  resonator_id   TEXT NOT NULL,
  uid            TEXT NOT NULL REFERENCES players (uid),
  build_id       TEXT NOT NULL REFERENCES builds (id),
  best_scenario  TEXT NOT NULL REFERENCES scenarios (id),
  score          REAL NOT NULL,
  dps            REAL NOT NULL,
  sequence       INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (ruleset_id, resonator_id, uid)
);
CREATE INDEX board_entries_rank ON board_entries (ruleset_id, resonator_id, score DESC);
CREATE INDEX board_entries_sequence ON board_entries (ruleset_id, resonator_id, sequence, score DESC);
