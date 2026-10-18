-- +goose Up
-- v2: a heart on a letter (the reader's reaction, the writer sees it) and
-- "our song" (a pin either of you picks; Our Space plays it in Together).
ALTER TABLE notes ADD COLUMN hearted_at timestamptz;
ALTER TABLE relationships ADD COLUMN song_pin_id uuid REFERENCES pins (id) ON DELETE SET NULL;

ALTER TABLE user_notices DROP CONSTRAINT user_notices_kind_check;
ALTER TABLE user_notices ADD CONSTRAINT user_notices_kind_check
    CHECK (kind IN ('space_closed', 'partner_number_updated', 'note_delivered', 'plan_reminder', 'plan_answer', 'together_invite', 'palette_changed', 'note_hearted', 'song_changed'));

-- +goose Down
ALTER TABLE user_notices DROP CONSTRAINT user_notices_kind_check;
ALTER TABLE user_notices ADD CONSTRAINT user_notices_kind_check
    CHECK (kind IN ('space_closed', 'partner_number_updated', 'note_delivered', 'plan_reminder', 'plan_answer', 'together_invite', 'palette_changed'));
ALTER TABLE relationships DROP COLUMN song_pin_id;
ALTER TABLE notes DROP COLUMN hearted_at;
