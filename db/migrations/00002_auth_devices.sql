-- +goose Up
-- Devices: a session remembers which device it came from, so a phone code on a
-- device this account has used before is enough, and on a new device it isn't.
ALTER TABLE sessions ADD COLUMN device_hash bytea NOT NULL DEFAULT '\x'::bytea;
CREATE INDEX sessions_user_device ON sessions (user_id, device_hash);

-- An approved verification can be spent once (e.g. to confirm leaving or a number change).
ALTER TABLE phone_verifications ADD COLUMN consumed_at timestamptz;

-- +goose Down
ALTER TABLE phone_verifications DROP COLUMN consumed_at;
DROP INDEX sessions_user_device;
ALTER TABLE sessions DROP COLUMN device_hash;
