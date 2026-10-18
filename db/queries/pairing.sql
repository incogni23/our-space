-- name: CreateUser :one
INSERT INTO users (phone_e164, phone_verified_at, display_name)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByPhone :one
SELECT * FROM users WHERE phone_e164 = $1;

-- name: LockUsers :many
-- Lock in id order so concurrent pairings never deadlock.
SELECT id, phone_verified_at FROM users
WHERE id = ANY(@ids::uuid[])
ORDER BY id
FOR UPDATE;

-- name: OpenMembership :one
SELECT r.id, r.name, r.status, r.created_by, r.activated_at
FROM relationship_members rm
JOIN relationships r ON r.id = rm.relationship_id
WHERE rm.user_id = $1 AND rm.left_at IS NULL;

-- name: LastLeftActiveRelationship :one
-- Cooldown applies after leaving a relationship that was ever active,
-- not after closing a space nobody joined.
SELECT rm.left_at::timestamptz AS left_at
FROM relationship_members rm
JOIN relationships r ON r.id = rm.relationship_id
WHERE rm.user_id = $1 AND rm.left_at IS NOT NULL AND r.activated_at IS NOT NULL
ORDER BY rm.left_at DESC
LIMIT 1;

-- name: CreateRelationship :one
INSERT INTO relationships (name, created_by)
VALUES ($1, $2)
RETURNING *;

-- name: GetRelationshipForUpdate :one
SELECT * FROM relationships WHERE id = $1 FOR UPDATE;

-- name: AddMember :exec
INSERT INTO relationship_members (relationship_id, user_id, joined_at)
VALUES ($1, $2, $3);

-- name: OpenMembers :many
SELECT u.id, u.display_name, u.person_tint, u.time_zone, rm.joined_at
FROM relationship_members rm
JOIN users u ON u.id = rm.user_id
WHERE rm.relationship_id = $1 AND rm.left_at IS NULL
ORDER BY rm.joined_at;

-- name: ActivateRelationship :execrows
UPDATE relationships
SET status = 'active', activated_at = $2
WHERE id = $1 AND status = 'pending';

-- name: CloseOpenMemberships :execrows
UPDATE relationship_members
SET left_at = $2
WHERE relationship_id = $1 AND left_at IS NULL;

-- name: UnlinkRelationship :exec
UPDATE relationships
SET status = 'unlinked', unlinked_at = $2, unlinked_by = $3, read_only_until = $4
WHERE id = $1;

-- name: CreateInvitation :one
INSERT INTO relationship_invitations (relationship_id, inviter_id, token_hash, invitee_name, created_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: RevokeOpenInvitations :exec
UPDATE relationship_invitations
SET state = 'revoked', responded_at = $2
WHERE relationship_id = $1 AND state = 'open';

-- name: GetInvitationByTokenForUpdate :one
SELECT * FROM relationship_invitations WHERE token_hash = $1 FOR UPDATE;

-- name: GetLatestInvitation :one
SELECT * FROM relationship_invitations
WHERE relationship_id = $1
ORDER BY created_at DESC
LIMIT 1;

-- name: SetInvitationState :exec
UPDATE relationship_invitations
SET state = $2, responded_at = $3, accepted_by = sqlc.narg(accepted_by)
WHERE id = $1;

-- name: GetInvitationPreview :one
SELECT i.id, i.state, i.expires_at, i.inviter_id, i.invitee_name,
       r.name AS space_name, r.status AS space_status,
       u.display_name AS inviter_name
FROM relationship_invitations i
JOIN relationships r ON r.id = i.relationship_id
JOIN users u ON u.id = i.inviter_id
WHERE i.token_hash = $1;

-- name: GetInvitationByToken :one
SELECT * FROM relationship_invitations WHERE token_hash = $1;
