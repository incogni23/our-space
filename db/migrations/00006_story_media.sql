-- +goose Up
-- Photos. Stored after server-side processing: orientation applied, all metadata
-- (including GPS) removed, a display copy and a thumbnail. The upload itself is
-- never kept. Served only through the API to members of the space.
CREATE TABLE media (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id uuid NOT NULL REFERENCES relationships(id),
    uploaded_by     uuid NOT NULL REFERENCES users(id),
    width           int NOT NULL CHECK (width > 0),
    height          int NOT NULL CHECK (height > 0),
    bytes           bigint NOT NULL CHECK (bytes > 0),
    key_full        text NOT NULL,
    key_thumb       text NOT NULL,
    taken_at        timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);
CREATE INDEX media_relationship ON media (relationship_id, created_at DESC) WHERE deleted_at IS NULL;

-- Our Story (E0): moments, trips, changes and where it started.
CREATE TABLE memories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id uuid NOT NULL REFERENCES relationships(id),
    created_by      uuid NOT NULL REFERENCES users(id),
    kind            text NOT NULL CHECK (kind IN ('moment', 'trip', 'change', 'start')),
    title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    caption         text NOT NULL DEFAULT '' CHECK (length(caption) <= 500),
    place           text NOT NULL DEFAULT '' CHECK (length(place) <= 120),
    happened_on     date NOT NULL,
    ends_on         date CHECK (ends_on IS NULL OR ends_on >= happened_on),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);
CREATE INDEX memories_timeline ON memories (relationship_id, happened_on DESC) WHERE deleted_at IS NULL;

CREATE TABLE memory_media (
    memory_id uuid NOT NULL REFERENCES memories(id),
    media_id  uuid NOT NULL REFERENCES media(id),
    position  int NOT NULL,
    PRIMARY KEY (memory_id, media_id)
);
CREATE INDEX memory_media_order ON memory_media (memory_id, position);

-- +goose Down
DROP TABLE memory_media;
DROP TABLE memories;
DROP TABLE media;
