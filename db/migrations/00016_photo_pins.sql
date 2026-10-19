-- +goose Up
-- Photo pins: a photo saved straight to a board. The photo is the pin's
-- preview_media_id (status 'done'), so every place that shows previews shows it.
ALTER TABLE pins DROP CONSTRAINT pins_kind_check;
ALTER TABLE pins ADD CONSTRAINT pins_kind_check CHECK (kind IN ('link', 'place', 'song', 'idea', 'photo'));

-- +goose Down
DELETE FROM pins WHERE kind = 'photo';
ALTER TABLE pins DROP CONSTRAINT pins_kind_check;
ALTER TABLE pins ADD CONSTRAINT pins_kind_check CHECK (kind IN ('link', 'place', 'song', 'idea'));
