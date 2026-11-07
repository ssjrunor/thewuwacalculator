-- retention: when a card's image was erased from CARDS (an opt-out, or a
-- refused card past its keep window). the row stays, so the link still names
-- the card; a later submission of it fetches the image again.

ALTER TABLE cards ADD COLUMN image_erased_at INTEGER;
CREATE INDEX cards_retention ON cards (status, image_erased_at, fetched_at);
