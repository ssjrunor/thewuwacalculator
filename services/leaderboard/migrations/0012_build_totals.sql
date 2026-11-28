-- Author: Runor Ewhro
-- description: kept builds counted across every board for the activity page's "ranked / unranked" line, because
--              summing player_boards on each read walks every player. triggers follow every writer of player_boards
--              (projections, seeds, purges); the ranked count is the live boards' totals, and the rest of the kept
--              builds are unranked
CREATE TABLE totals (
  key  TEXT PRIMARY KEY,
  n    INTEGER NOT NULL
) WITHOUT ROWID;

INSERT INTO totals (key, n) VALUES ('kept_builds', (SELECT COALESCE(SUM(standing), 0) FROM player_boards));

CREATE TRIGGER player_boards_kept_in AFTER INSERT ON player_boards
BEGIN
  UPDATE totals SET n = n + NEW.standing WHERE key = 'kept_builds';
END;

CREATE TRIGGER player_boards_kept_out AFTER DELETE ON player_boards
BEGIN
  UPDATE totals SET n = n - OLD.standing WHERE key = 'kept_builds';
END;

CREATE TRIGGER player_boards_kept_move AFTER UPDATE OF standing ON player_boards WHEN OLD.standing <> NEW.standing
BEGIN
  UPDATE totals SET n = n + NEW.standing - OLD.standing WHERE key = 'kept_builds';
END;
