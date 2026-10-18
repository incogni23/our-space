-- +goose Up
-- Plans (D1–D3). Time rule (5.4): store the instant in UTC plus the zone the plan is
-- anchored to. Weekly plans repeat on the anchor zone's wall clock, so they hold
-- across DST and the other person's local time moves instead.
CREATE TABLE plans (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id     uuid NOT NULL REFERENCES relationships(id),
    created_by          uuid NOT NULL REFERENCES users(id),
    pin_id              uuid REFERENCES pins(id),
    kind                text NOT NULL DEFAULT 'plan' CHECK (kind IN ('plan', 'call')),
    title               text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    place               text NOT NULL DEFAULT '' CHECK (length(place) <= 200),
    notes               text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
    starts_at           timestamptz NOT NULL,
    anchor_tz           text NOT NULL CHECK (length(anchor_tz) BETWEEN 1 AND 64),
    repeat              text NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'weekly')),
    -- proposed: waiting for the other person. confirmed: both in.
    status              text NOT NULL DEFAULT 'proposed'
                        CHECK (status IN ('proposed', 'confirmed', 'declined', 'cancelled')),
    suggested_starts_at timestamptz,
    suggested_by        uuid REFERENCES users(id),
    responded_by        uuid REFERENCES users(id),
    responded_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK ((suggested_starts_at IS NULL) = (suggested_by IS NULL))
);
CREATE INDEX plans_relationship_time ON plans (relationship_id, starts_at)
    WHERE status IN ('proposed', 'confirmed');

-- +goose Down
DROP TABLE plans;
