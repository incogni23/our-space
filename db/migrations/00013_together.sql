-- +goose Up
-- Together v1 (5.4 #04): shared start, shared pause, chat; each person opens the
-- media in their own app. Position is stored as (position_ms at position_at);
-- while playing, now's position is position_ms + (now - position_at).
-- Presence exists only inside a session and is never stored.
CREATE TABLE together_sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id uuid NOT NULL REFERENCES relationships(id),
    started_by      uuid NOT NULL REFERENCES users(id),
    title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    url             text CHECK (url IS NULL OR length(url) <= 2048),
    status          text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'paused', 'ended')),
    position_ms     bigint NOT NULL DEFAULT 0 CHECK (position_ms >= 0),
    position_at     timestamptz NOT NULL DEFAULT now(),
    paused_reason   text CHECK (paused_reason IS NULL OR paused_reason IN ('someone', 'connection')),
    updated_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    ended_at        timestamptz,
    CHECK ((status = 'ended') = (ended_at IS NOT NULL))
);
-- One open session per space.
CREATE UNIQUE INDEX together_one_open ON together_sessions (relationship_id) WHERE ended_at IS NULL;

ALTER TABLE user_notices DROP CONSTRAINT user_notices_kind_check;
ALTER TABLE user_notices ADD CONSTRAINT user_notices_kind_check
    CHECK (kind IN ('space_closed', 'partner_number_updated', 'note_delivered', 'plan_reminder', 'plan_answer', 'together_invite'));

-- +goose Down
ALTER TABLE user_notices DROP CONSTRAINT user_notices_kind_check;
ALTER TABLE user_notices ADD CONSTRAINT user_notices_kind_check
    CHECK (kind IN ('space_closed', 'partner_number_updated', 'note_delivered', 'plan_reminder', 'plan_answer'));
DROP TABLE together_sessions;
