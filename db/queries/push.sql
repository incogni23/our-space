-- name: UpsertPushSubscription :exec
-- An endpoint belongs to whoever subscribed it last (shared browsers move it).
INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
VALUES ($1, $2, $3, $4)
ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth;

-- name: DeletePushSubscription :exec
DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2;

-- name: DeletePushEndpoint :exec
DELETE FROM push_subscriptions WHERE endpoint = $1;

-- name: PushSubscriptionsFor :many
SELECT * FROM push_subscriptions WHERE user_id = $1;

-- name: TouchPushSubscription :exec
UPDATE push_subscriptions SET last_used_at = now() WHERE id = $1;

-- name: DeleteUserPushSubscriptions :exec
DELETE FROM push_subscriptions WHERE user_id = $1;
