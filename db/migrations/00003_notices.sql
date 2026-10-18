-- +goose Up
-- In-app notices: quiet, one-time messages shown on next open (canvas 5.2).
CREATE TABLE user_notices (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id),
    kind       text NOT NULL CHECK (kind IN ('space_closed', 'partner_number_updated')),
    payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    seen_at    timestamptz
);
CREATE INDEX user_notices_unseen ON user_notices (user_id, created_at) WHERE seen_at IS NULL;

-- Wrong recovery codes on a pending session; the session is revoked after too many.
ALTER TABLE sessions ADD COLUMN second_factor_attempts int NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE sessions DROP COLUMN second_factor_attempts;
DROP TABLE user_notices;
