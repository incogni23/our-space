-- name: CreateNotice :exec
INSERT INTO user_notices (user_id, kind, payload, created_at) VALUES ($1, $2, $3, $4);

-- name: UnseenNotices :many
SELECT id, kind, payload, created_at FROM user_notices
WHERE user_id = $1 AND seen_at IS NULL
ORDER BY created_at DESC
LIMIT 20;

-- name: MarkNoticeSeen :execrows
UPDATE user_notices SET seen_at = $3 WHERE id = $1 AND user_id = $2 AND seen_at IS NULL;

-- name: PartnerIDs :many
-- The other open member(s) of the user's current space.
SELECT rm2.user_id
FROM relationship_members rm1
JOIN relationship_members rm2 ON rm2.relationship_id = rm1.relationship_id AND rm2.user_id <> rm1.user_id
WHERE rm1.user_id = $1 AND rm1.left_at IS NULL AND rm2.left_at IS NULL;

-- name: OtherMembers :many
SELECT user_id FROM relationship_members WHERE relationship_id = $1 AND user_id <> $2;

-- name: BumpSecondFactorAttempts :one
UPDATE sessions SET second_factor_attempts = second_factor_attempts + 1 WHERE id = $1
RETURNING second_factor_attempts;

-- name: SeeSessionInvites :exec
-- A Together invite stops mattering once the session ends or they walk in.
UPDATE user_notices SET seen_at = now()
WHERE kind = 'together_invite' AND payload->>'sessionId' = @session_id::text AND seen_at IS NULL
  AND (sqlc.narg(user_id)::uuid IS NULL OR user_id = sqlc.narg(user_id)::uuid);
