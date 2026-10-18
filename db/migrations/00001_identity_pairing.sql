-- +goose Up
-- Identity and exclusive pairing.
-- Invariants enforced here, not only in the service:
--   * one open membership per user (partial unique index)
--   * at most two members per relationship, ever (trigger)
--   * relationship status matches its open members (deferred constraint trigger)

CREATE TABLE users (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_e164               text UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
    phone_verified_at        timestamptz,
    display_name             text NOT NULL DEFAULT '' CHECK (length(display_name) <= 40),
    person_tint              text NOT NULL DEFAULT 'terracotta'
                             CHECK (person_tint IN ('terracotta', 'sage', 'mauve')),
    backup_email             text CHECK (backup_email IS NULL OR length(backup_email) <= 254),
    backup_email_verified_at timestamptz,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);

-- A phone code proves control of a number. Raw codes are never stored: the provider
-- holds them, or we keep a hash for the dev provider.
CREATE TABLE phone_verifications (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_e164    text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
    purpose       text NOT NULL CHECK (purpose IN ('sign_in', 'change_number', 'leave')),
    user_id       uuid REFERENCES users(id),
    provider      text NOT NULL,
    provider_ref  text NOT NULL,
    code_hash     bytea,
    status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'expired', 'failed')),
    attempts      int  NOT NULL DEFAULT 0,
    request_ip    inet,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    completed_at  timestamptz
);
CREATE INDEX phone_verifications_phone_recent ON phone_verifications (phone_e164, created_at DESC);
CREATE INDEX phone_verifications_ip_recent ON phone_verifications (request_ip, created_at DESC);

CREATE TABLE recovery_codes (
    user_id    uuid NOT NULL REFERENCES users(id),
    code_hash  bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    used_at    timestamptz,
    PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE sessions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users(id),
    token_hash         bytea NOT NULL UNIQUE,
    device_label       text NOT NULL DEFAULT '',
    -- A new device on an existing account stays 'needs_second_factor' until a backup
    -- email or recovery code is used. A phone code alone never opens an existing space.
    status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'needs_second_factor', 'revoked')),
    created_at         timestamptz NOT NULL DEFAULT now(),
    last_seen_at       timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id) WHERE status <> 'revoked';

CREATE TABLE relationships (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'unlinked')),
    created_by       uuid NOT NULL REFERENCES users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    activated_at     timestamptz,
    unlinked_at      timestamptz,
    unlinked_by      uuid REFERENCES users(id),
    -- Both people can read and download until this time, then content is deleted.
    read_only_until  timestamptz,
    CHECK (status <> 'pending'  OR (activated_at IS NULL AND unlinked_at IS NULL)),
    CHECK (status <> 'active'   OR (activated_at IS NOT NULL AND unlinked_at IS NULL)),
    CHECK (status <> 'unlinked' OR unlinked_at IS NOT NULL)
);

CREATE TABLE relationship_members (
    relationship_id uuid NOT NULL REFERENCES relationships(id),
    user_id         uuid NOT NULL REFERENCES users(id),
    joined_at       timestamptz NOT NULL DEFAULT now(),
    left_at         timestamptz,
    PRIMARY KEY (relationship_id, user_id)
);

-- One person, one relationship.
CREATE UNIQUE INDEX one_open_membership_per_user
    ON relationship_members (user_id)
    WHERE left_at IS NULL;

CREATE TABLE relationship_invitations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id uuid NOT NULL REFERENCES relationships(id),
    inviter_id      uuid NOT NULL REFERENCES users(id),
    token_hash      bytea NOT NULL UNIQUE,
    invitee_name    text NOT NULL DEFAULT '' CHECK (length(invitee_name) <= 40),
    state           text NOT NULL DEFAULT 'open'
                    CHECK (state IN ('open', 'accepted', 'declined', 'revoked', 'expired')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    responded_at    timestamptz,
    accepted_by     uuid REFERENCES users(id),
    CHECK ((state = 'accepted') = (accepted_by IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_invitation_per_relationship
    ON relationship_invitations (relationship_id)
    WHERE state = 'open';

-- +goose StatementBegin
-- Members can only join a pending relationship, and a relationship holds two people, ever.
CREATE FUNCTION relationship_members_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    rel_status text;
    n int;
BEGIN
    SELECT status INTO rel_status FROM relationships WHERE id = NEW.relationship_id FOR UPDATE;
    IF rel_status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'relationship % is not accepting members', NEW.relationship_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'relationship_not_pending';
    END IF;
    SELECT count(*) INTO n FROM relationship_members WHERE relationship_id = NEW.relationship_id;
    IF n >= 2 THEN
        RAISE EXCEPTION 'relationship % already has two members', NEW.relationship_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'relationship_two_members';
    END IF;
    RETURN NEW;
END $$;
-- +goose StatementEnd

CREATE TRIGGER relationship_members_before_insert
    BEFORE INSERT ON relationship_members
    FOR EACH ROW EXECUTE FUNCTION relationship_members_before_insert();

-- +goose StatementBegin
-- Leaving is final for that relationship: left_at can't be cleared or moved.
CREATE FUNCTION relationship_members_before_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.relationship_id <> OLD.relationship_id OR NEW.user_id <> OLD.user_id THEN
        RAISE EXCEPTION 'membership identity is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.left_at IS NOT NULL AND NEW.left_at IS DISTINCT FROM OLD.left_at THEN
        RAISE EXCEPTION 'a member who left cannot rejoin' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
-- +goose StatementEnd

CREATE TRIGGER relationship_members_before_update
    BEFORE UPDATE ON relationship_members
    FOR EACH ROW EXECUTE FUNCTION relationship_members_before_update();

-- +goose StatementBegin
-- At commit: pending has 1 open member, active has 2, unlinked has 0.
CREATE FUNCTION check_relationship_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    rel_id uuid;
    rel_status text;
    n int;
BEGIN
    IF TG_TABLE_NAME = 'relationships' THEN
        rel_id := NEW.id;
    ELSE
        rel_id := NEW.relationship_id;
    END IF;
    SELECT status INTO rel_status FROM relationships WHERE id = rel_id;
    SELECT count(*) INTO n FROM relationship_members WHERE relationship_id = rel_id AND left_at IS NULL;
    IF (rel_status = 'pending' AND n <> 1)
       OR (rel_status = 'active' AND n <> 2)
       OR (rel_status = 'unlinked' AND n <> 0) THEN
        RAISE EXCEPTION 'relationship % is %, but has % open members', rel_id, rel_status, n
            USING ERRCODE = 'check_violation', CONSTRAINT = 'relationship_consistency';
    END IF;
    RETURN NULL;
END $$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER relationships_consistency
    AFTER INSERT OR UPDATE ON relationships
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_relationship_consistency();

CREATE CONSTRAINT TRIGGER relationship_members_consistency
    AFTER INSERT OR UPDATE ON relationship_members
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_relationship_consistency();

-- +goose Down
DROP TABLE relationship_invitations;
DROP TABLE relationship_members;
DROP TABLE relationships;
DROP FUNCTION check_relationship_consistency();
DROP FUNCTION relationship_members_before_update();
DROP FUNCTION relationship_members_before_insert();
DROP TABLE sessions;
DROP TABLE recovery_codes;
DROP TABLE phone_verifications;
DROP TABLE users;
