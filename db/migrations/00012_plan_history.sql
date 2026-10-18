-- +goose Up
-- Every move on a plan, kept for good (plans are never deleted; declined and
-- cancelled ones stay in History).
CREATE TABLE plan_events (
    id         bigserial PRIMARY KEY,
    plan_id    uuid NOT NULL REFERENCES plans(id),
    user_id    uuid NOT NULL REFERENCES users(id),
    action     text NOT NULL CHECK (action IN ('created', 'accepted', 'declined', 'suggested', 'moved', 'edited', 'cancelled')),
    at_time    timestamptz, -- the time proposed or suggested, when relevant
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_events_plan ON plan_events (plan_id, id);

-- Plans made before history existed: record that they were created.
INSERT INTO plan_events (plan_id, user_id, action, at_time, created_at)
SELECT id, created_by, 'created', starts_at, created_at FROM plans;

-- +goose Down
DROP TABLE plan_events;
