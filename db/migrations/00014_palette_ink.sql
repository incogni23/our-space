-- +goose Up
-- v2 "Love, in print": each space has a colour family (chosen together, either can
-- change it); each person has their own handwriting ink.
ALTER TABLE relationships ADD COLUMN palette text NOT NULL DEFAULT 'cherry'
    CHECK (palette IN ('cherry', 'lavender', 'matcha', 'ocean', 'peach', 'midnight'));
ALTER TABLE users ADD COLUMN ink text NOT NULL DEFAULT 'accent'
    CHECK (ink IN ('accent', 'second', 'ink', 'pencil'));

ALTER TABLE user_notices DROP CONSTRAINT user_notices_kind_check;
ALTER TABLE user_notices ADD CONSTRAINT user_notices_kind_check
    CHECK (kind IN ('space_closed', 'partner_number_updated', 'note_delivered', 'plan_reminder', 'plan_answer', 'together_invite', 'palette_changed'));

-- +goose Down
ALTER TABLE user_notices DROP CONSTRAINT user_notices_kind_check;
ALTER TABLE user_notices ADD CONSTRAINT user_notices_kind_check
    CHECK (kind IN ('space_closed', 'partner_number_updated', 'note_delivered', 'plan_reminder', 'plan_answer', 'together_invite'));
ALTER TABLE users DROP COLUMN ink;
ALTER TABLE relationships DROP COLUMN palette;
