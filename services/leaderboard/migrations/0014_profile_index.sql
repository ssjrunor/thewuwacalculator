-- Author: Runor Ewhro
-- description: the profiles index (GET /profiles) lists uids with a profile anyone may open, ordered by last upload,
--              first upload, kept builds or name. triggers on player_boards (as with totals in 0012) store each uid's
--              kept builds and listed boards on its players row, and the index pages and counts off partial indexes
--              over those columns
ALTER TABLE players ADD COLUMN builds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN listed_boards INTEGER NOT NULL DEFAULT 0;

UPDATE players SET builds = t.n, listed_boards = t.l
  FROM (SELECT uid, SUM(standing) AS n, COUNT(listed) AS l FROM player_boards GROUP BY uid) AS t
  WHERE players.uid = t.uid;

CREATE TRIGGER player_boards_profile_in AFTER INSERT ON player_boards
BEGIN
  UPDATE players SET builds = builds + NEW.standing, listed_boards = listed_boards + (NEW.listed IS NOT NULL) WHERE uid = NEW.uid;
END;

CREATE TRIGGER player_boards_profile_out AFTER DELETE ON player_boards
BEGIN
  UPDATE players SET builds = builds - OLD.standing, listed_boards = listed_boards - (OLD.listed IS NOT NULL) WHERE uid = OLD.uid;
END;

CREATE TRIGGER player_boards_profile_move AFTER UPDATE OF standing, listed ON player_boards
  WHEN OLD.standing <> NEW.standing OR (OLD.listed IS NULL) <> (NEW.listed IS NULL)
BEGIN
  UPDATE players SET builds = builds + NEW.standing - OLD.standing,
    listed_boards = listed_boards + (NEW.listed IS NOT NULL) - (OLD.listed IS NOT NULL) WHERE uid = NEW.uid;
END;

-- one index per order over the listed set (src/api/profiles.ts LISTED repeats this condition word for word, which
-- the planner needs to use them); the uid breaks ties so pages never overlap
CREATE INDEX players_profiles_upload ON players (last_seen_at, uid)
  WHERE anonymous = 0 AND setup_at IS NULL AND opted_out_at IS NULL AND listed_boards > 0;
CREATE INDEX players_profiles_age ON players (first_seen_at, uid)
  WHERE anonymous = 0 AND setup_at IS NULL AND opted_out_at IS NULL AND listed_boards > 0;
CREATE INDEX players_profiles_builds ON players (builds, last_seen_at, uid)
  WHERE anonymous = 0 AND setup_at IS NULL AND opted_out_at IS NULL AND listed_boards > 0;
CREATE INDEX players_profiles_name ON players (last_name COLLATE NOCASE, uid)
  WHERE anonymous = 0 AND setup_at IS NULL AND opted_out_at IS NULL AND listed_boards > 0;
