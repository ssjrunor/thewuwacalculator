-- Author: Runor Ewhro
-- description: a player's name is read off their cards, and cards arrive in any order: a name is only replaced by one
--              read off a card drawn at or after the card it came from (players.name_at, that card's first-drawn
--              date). existing names have no date, so the next card with a name replaces them
ALTER TABLE players ADD COLUMN name_at INTEGER;
