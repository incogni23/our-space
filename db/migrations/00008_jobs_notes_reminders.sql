-- +goose Up
-- Durable jobs: claimed with SKIP LOCKED, retried with backoff, never lost on restart.
CREATE TABLE jobs (
    id           bigserial PRIMARY KEY,
    kind         text NOT NULL,
    payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
    run_at       timestamptz NOT NULL DEFAULT now(),
    attempts     int NOT NULL DEFAULT 0,
    max_attempts int NOT NULL DEFAULT 8,
    locked_until timestamptz,
    last_error   text,
    done_at      timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    dedupe_key   text
);
CREATE INDEX jobs_ready ON jobs (run_at) WHERE done_at IS NULL;
-- At most one pending job per key (e.g. one reminder per plan, person and occurrence).
CREATE UNIQUE INDEX jobs_pending_dedupe ON jobs (dedupe_key) WHERE done_at IS NULL AND dedupe_key IS NOT NULL;

-- Notes (NoteLetter, 4.3): draft → scheduled → delivered. The recipient never
-- receives the body before delivery; the author never learns if it was opened.
CREATE TABLE notes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id uuid NOT NULL REFERENCES relationships(id),
    author_id       uuid NOT NULL REFERENCES users(id),
    recipient_id    uuid NOT NULL REFERENCES users(id),
    body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    state           text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'scheduled', 'delivered')),
    deliver_at      timestamptz,
    deliver_tz      text CHECK (deliver_tz IS NULL OR length(deliver_tz) <= 64),
    delivered_at    timestamptz,
    opened_at       timestamptz, -- recipient-only; never returned to the author
    kept            boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    CHECK (author_id <> recipient_id),
    CHECK (state <> 'scheduled' OR deliver_at IS NOT NULL),
    CHECK (state <> 'delivered' OR delivered_at IS NOT NULL)
);
CREATE INDEX notes_recipient ON notes (recipient_id, relationship_id) WHERE deleted_at IS NULL;
CREATE INDEX notes_author ON notes (author_id, relationship_id) WHERE deleted_at IS NULL;

-- Plan reminders: 'evening_before' = 8 pm the day before in each person's own zone.
ALTER TABLE plans ADD COLUMN remind text NOT NULL DEFAULT 'none'
    CHECK (remind IN ('none', 'evening_before', 'hour_before'));

-- Closed spaces: content is deleted when the read-only window ends.
ALTER TABLE relationships ADD COLUMN purged_at timestamptz;

ALTER TABLE user_notices DROP CONSTRAINT user_notices_kind_check;
ALTER TABLE user_notices ADD CONSTRAINT user_notices_kind_check
    CHECK (kind IN ('space_closed', 'partner_number_updated', 'note_delivered', 'plan_reminder'));

-- +goose Down
ALTER TABLE user_notices DROP CONSTRAINT user_notices_kind_check;
ALTER TABLE user_notices ADD CONSTRAINT user_notices_kind_check
    CHECK (kind IN ('space_closed', 'partner_number_updated'));
ALTER TABLE relationships DROP COLUMN purged_at;
ALTER TABLE plans DROP COLUMN remind;
DROP TABLE notes;
DROP TABLE jobs;
