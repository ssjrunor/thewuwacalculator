-- rulesets: a frozen scoring setup (engine, rotation generator, game data,
-- scenarios, refs). any change creates a new ruleset; one is never edited.
-- settings.live_ruleset points at the one boards read.

CREATE TABLE rulesets (
  id             TEXT PRIMARY KEY,                      -- e.g. '2026-11a'
  game_ver       TEXT NOT NULL,                         -- '3.8.3'
  engine_ver     TEXT NOT NULL,
  rotation_ver   TEXT NOT NULL,                         -- generator + recipe data version
  manifest_key   TEXT NOT NULL,                         -- LB_DATA key of the ruleset manifest
  manifest_sha256 TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('building', 'live', 'archived')),
  created_at     INTEGER NOT NULL,
  live_at        INTEGER,
  archived_at    INTEGER
);

CREATE TABLE scenarios (
  id             TEXT PRIMARY KEY,                      -- '<ruleset>:<resonator>:<team>:<weapon>'
  ruleset_id     TEXT NOT NULL REFERENCES rulesets (id),
  resonator_id   TEXT NOT NULL,
  team_id        TEXT NOT NULL,                         -- data/scenarios.json team, e.g. 't1'
  recipe_sha256  TEXT NOT NULL,                         -- the team's rotation recipe
  team_key       TEXT NOT NULL,                         -- sorted member ids, '1102-1312-1505'
  weapon_id      TEXT NOT NULL,
  weapon_rank    INTEGER NOT NULL CHECK (weapon_rank BETWEEN 1 AND 5),
  weapon_role    TEXT NOT NULL CHECK (weapon_role IN ('signature', 'primary', 'alternative', 'standard')),
  team_rank      INTEGER NOT NULL                       -- 1-5, the team's order for this resonator
);
CREATE INDEX scenarios_lookup ON scenarios (ruleset_id, resonator_id);

CREATE TABLE scenario_members (
  scenario_id    TEXT NOT NULL REFERENCES scenarios (id),
  slot           INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 2),
  resonator_id   TEXT NOT NULL,
  mode           TEXT,                                  -- resonance mode; null when the kit has none
  team_slot      TEXT,                                  -- teammate build '<team>:<seat>'; null for the scored resonator
  is_context     INTEGER NOT NULL CHECK (is_context IN (0, 1)),
  PRIMARY KEY (scenario_id, slot)
);
CREATE INDEX scenario_members_resonator ON scenario_members (resonator_id);

CREATE TABLE scenario_refs (
  scenario_id    TEXT NOT NULL REFERENCES scenarios (id),
  sequence       INTEGER NOT NULL CHECK (sequence BETWEEN 0 AND 6),
  baseline_dps   REAL NOT NULL,                         -- 0%
  bench_dps      REAL NOT NULL,                         -- 100%
  perfect_dps    REAL NOT NULL,                         -- 200%
  programs       TEXT NOT NULL,                         -- json: rotation program sha256 per reference build
  status         TEXT NOT NULL CHECK (status IN ('ok', 'unsupported')),
  PRIMARY KEY (scenario_id, sequence)
);

CREATE TABLE settings (
  key            TEXT PRIMARY KEY,                      -- 'live_ruleset'
  value          TEXT NOT NULL,
  updated_at     INTEGER NOT NULL
);
