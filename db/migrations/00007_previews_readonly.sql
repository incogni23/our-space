-- +goose Up
-- Link previews, fetched server-side after a pin is saved. The image is re-encoded
-- and stored like any photo, so viewers never load third-party URLs.
ALTER TABLE pins
    ADD COLUMN preview_status      text NOT NULL DEFAULT 'none' CHECK (preview_status IN ('none', 'pending', 'done', 'failed')),
    ADD COLUMN preview_site        text NOT NULL DEFAULT '' CHECK (length(preview_site) <= 120),
    ADD COLUMN preview_description text NOT NULL DEFAULT '' CHECK (length(preview_description) <= 300),
    ADD COLUMN preview_media_id    uuid REFERENCES media(id);

-- +goose Down
ALTER TABLE pins
    DROP COLUMN preview_media_id,
    DROP COLUMN preview_description,
    DROP COLUMN preview_site,
    DROP COLUMN preview_status;
