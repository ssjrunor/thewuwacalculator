-- Author: Runor Ewhro
-- description: the boards a rollout carries over unchanged (api/moderation/carry.ts): their scenarios, anchors and
--              every unit their builds read are equal on both rulesets, so each takes the new ruleset at go-live by
--              renaming its tables (BoardStore.carryLive) without a rescore
CREATE TABLE rollout_carry (
  ruleset_id    TEXT NOT NULL,
  resonator_id  TEXT NOT NULL,
  PRIMARY KEY (ruleset_id, resonator_id)
) WITHOUT ROWID;
