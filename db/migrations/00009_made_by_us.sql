-- +goose Up
-- Made by Us (Phase 4). A creation is a design spec plus, once rendered, an image
-- stored as its own media row (originals are never altered). Every render bumps
-- `version`; approvals are bound to a version, so any edit asks both people again.
CREATE TABLE creations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id uuid NOT NULL REFERENCES relationships(id),
    created_by      uuid NOT NULL REFERENCES users(id),
    memory_id       uuid REFERENCES memories(id),
    format          text NOT NULL CHECK (format IN ('collage', 'softlaunch')),
    spec            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(spec::text) <= 16384),
    version         int NOT NULL DEFAULT 0,
    render_media_id uuid REFERENCES media(id),
    render_hash     text,
    -- private: stays in Our Story › Made. solo: export just for me (never "approved").
    -- ask_export / ask_link: needs both approvals of the current version.
    audience        text NOT NULL DEFAULT 'private' CHECK (audience IN ('private', 'solo', 'ask_export', 'ask_link')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    CHECK ((render_media_id IS NULL) = (version = 0))
);
CREATE INDEX creations_space ON creations (relationship_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE creation_approvals (
    id          bigserial PRIMARY KEY,
    creation_id uuid NOT NULL REFERENCES creations(id),
    user_id     uuid NOT NULL REFERENCES users(id),
    version     int NOT NULL CHECK (version > 0),
    decision    text NOT NULL CHECK (decision IN ('approved', 'change', 'declined', 'withdrawn')),
    comment     text NOT NULL DEFAULT '' CHECK (length(comment) <= 500),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creation_approvals_latest ON creation_approvals (creation_id, version, user_id, id DESC);

-- Preview links (F4): bearer token stored as a hash, expiry, revocable by either
-- person. No view tracking of any kind.
CREATE TABLE share_links (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creation_id     uuid NOT NULL REFERENCES creations(id),
    relationship_id uuid NOT NULL REFERENCES relationships(id),
    version         int NOT NULL,
    token_hash      bytea NOT NULL UNIQUE,
    created_by      uuid NOT NULL REFERENCES users(id),
    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz,
    revoked_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX share_links_creation ON share_links (creation_id) WHERE revoked_at IS NULL;

-- +goose Down
DROP TABLE share_links;
DROP TABLE creation_approvals;
DROP TABLE creations;
