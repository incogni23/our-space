-- +goose Up
-- "Usually awake" (A8): only used to suggest good times, never shown as online.
-- Hours 0–24 in the person's own zone; awake_to < awake_from wraps past midnight.
ALTER TABLE users ADD COLUMN awake_from smallint NOT NULL DEFAULT 7 CHECK (awake_from BETWEEN 0 AND 23);
ALTER TABLE users ADD COLUMN awake_to smallint NOT NULL DEFAULT 24 CHECK (awake_to BETWEEN 1 AND 24);
ALTER TABLE users ADD CONSTRAINT users_awake_span CHECK (awake_from <> awake_to);

-- +goose Down
ALTER TABLE users DROP CONSTRAINT users_awake_span;
ALTER TABLE users DROP COLUMN awake_to;
ALTER TABLE users DROP COLUMN awake_from;
