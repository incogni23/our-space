-- name: CreateCreation :one
INSERT INTO creations (relationship_id, created_by, memory_id, format, spec)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetCreation :one
SELECT * FROM creations WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL;

-- name: GetCreationForUpdate :one
SELECT * FROM creations WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL FOR UPDATE;

-- name: ListCreations :many
SELECT * FROM creations WHERE relationship_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC;

-- name: UpdateCreationSpec :one
UPDATE creations SET spec = $3, updated_at = now()
WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: SetCreationRender :one
UPDATE creations SET render_media_id = $3, render_hash = $4, version = version + 1, updated_at = now()
WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: SetCreationAudience :one
UPDATE creations SET audience = $3, updated_at = now()
WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: DeleteCreation :execrows
UPDATE creations SET deleted_at = now() WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL;

-- name: AddApproval :exec
INSERT INTO creation_approvals (creation_id, user_id, version, decision, comment) VALUES ($1, $2, $3, $4, $5);

-- name: LatestDecisions :many
-- Each person's latest decision on one version.
SELECT DISTINCT ON (user_id) user_id, decision, comment, created_at
FROM creation_approvals
WHERE creation_id = $1 AND version = $2
ORDER BY user_id, id DESC;

-- name: CreateShareLink :one
INSERT INTO share_links (creation_id, relationship_id, version, token_hash, created_by, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: LinksForCreation :many
SELECT * FROM share_links WHERE creation_id = $1 ORDER BY created_at DESC;

-- name: RevokeLink :execrows
UPDATE share_links SET revoked_at = now(), revoked_by = $3
WHERE id = $1 AND relationship_id = $2 AND revoked_at IS NULL;

-- name: RevokeLinksForCreation :exec
UPDATE share_links SET revoked_at = now(), revoked_by = $2 WHERE creation_id = $1 AND revoked_at IS NULL;

-- name: PublicLink :one
-- A link works only while: not revoked, not expired, still the creation's
-- current version, and the space is still open.
SELECT l.id, l.expires_at, c.render_media_id, c.version, c.format
FROM share_links l
JOIN creations c ON c.id = l.creation_id AND c.deleted_at IS NULL
JOIN relationships r ON r.id = l.relationship_id AND r.status = 'active'
WHERE l.token_hash = $1 AND l.revoked_at IS NULL AND l.expires_at > now() AND l.version = c.version;

-- name: GetMediaAny :one
SELECT * FROM media WHERE id = $1 AND deleted_at IS NULL;

-- name: PurgeShareLinks :exec
DELETE FROM share_links WHERE relationship_id = $1;

-- name: PurgeCreationApprovals :exec
DELETE FROM creation_approvals WHERE creation_id IN (SELECT id FROM creations WHERE relationship_id = $1);

-- name: PurgeCreations :exec
DELETE FROM creations WHERE relationship_id = $1;

-- name: PurgePlanEvents :exec
DELETE FROM plan_events WHERE plan_id IN (SELECT id FROM plans WHERE relationship_id = $1);

-- name: RevokeAllLinksForSpace :exec
-- Leaving turns off every preview link at once (they also stop serving when the space closes).
UPDATE share_links SET revoked_at = now(), revoked_by = $2 WHERE relationship_id = $1 AND revoked_at IS NULL;
