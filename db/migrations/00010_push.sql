-- +goose Up
-- Web Push subscriptions, one per browser/device. Used only for things with a
-- time (a note opening, a plan reminder), per canvas 5.2.
CREATE TABLE push_subscriptions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id),
    endpoint     text NOT NULL UNIQUE CHECK (length(endpoint) <= 1000),
    p256dh       text NOT NULL CHECK (length(p256dh) <= 200),
    auth         text NOT NULL CHECK (length(auth) <= 100),
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

-- +goose Down
DROP TABLE push_subscriptions;
