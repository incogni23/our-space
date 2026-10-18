-- +goose Up
-- Each person's clock, so the space can show both times (B1, plans).
ALTER TABLE users ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC' CHECK (length(time_zone) BETWEEN 1 AND 64);

-- Boards and pins belong to a relationship, never to one person. Every query is
-- scoped by relationship_id taken from the caller's open membership.
CREATE TABLE boards (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id uuid NOT NULL REFERENCES relationships(id),
    name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    created_by      uuid NOT NULL REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    archived_at     timestamptz
);
CREATE INDEX boards_relationship ON boards (relationship_id, created_at) WHERE archived_at IS NULL;

CREATE TABLE pins (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id uuid NOT NULL REFERENCES relationships(id),
    board_id        uuid NOT NULL REFERENCES boards(id),
    created_by      uuid NOT NULL REFERENCES users(id),
    kind            text NOT NULL CHECK (kind IN ('link', 'place', 'song', 'idea')),
    title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    url             text CHECK (url IS NULL OR length(url) <= 2048),
    note            text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
    status          text NOT NULL DEFAULT 'saved' CHECK (status IN ('saved', 'planned', 'done', 'remembered')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);
CREATE INDEX pins_board ON pins (board_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX pins_relationship_recent ON pins (relationship_id, created_at DESC) WHERE deleted_at IS NULL;

-- "Notes between you" on a pin (C3).
CREATE TABLE pin_notes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id     uuid NOT NULL REFERENCES pins(id),
    author_id  uuid NOT NULL REFERENCES users(id),
    body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pin_notes_pin ON pin_notes (pin_id, created_at);

-- +goose Down
DROP TABLE pin_notes;
DROP TABLE pins;
DROP TABLE boards;
ALTER TABLE users DROP COLUMN time_zone;
