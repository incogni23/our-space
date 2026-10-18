-- +goose Up
-- A record of sensitive account actions, for support and for spotting misuse.
-- Never shown to the partner. Content (notes, photos, pins) is never logged here.
CREATE TABLE audit_events (
    id              bigserial PRIMARY KEY,
    user_id         uuid REFERENCES users(id),
    relationship_id uuid REFERENCES relationships(id),
    action          text NOT NULL CHECK (length(action) <= 60),
    ip              inet,
    detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_user ON audit_events (user_id, created_at DESC);

-- "Dev said yes to coffee" (5.2 · Notification): a quiet in-app notice, no push.
ALTER TABLE user_notices DROP CONSTRAINT user_notices_kind_check;
ALTER TABLE user_notices ADD CONSTRAINT user_notices_kind_check
    CHECK (kind IN ('space_closed', 'partner_number_updated', 'note_delivered', 'plan_reminder', 'plan_answer'));

-- +goose Down
ALTER TABLE user_notices DROP CONSTRAINT user_notices_kind_check;
ALTER TABLE user_notices ADD CONSTRAINT user_notices_kind_check
    CHECK (kind IN ('space_closed', 'partner_number_updated', 'note_delivered', 'plan_reminder'));
DROP TABLE audit_events;
