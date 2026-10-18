-- name: ActiveSpaceFor :one
-- The caller's space, only if it is active (two people). Gate for all content.
SELECT r.id, r.name FROM relationship_members rm
JOIN relationships r ON r.id = rm.relationship_id
WHERE rm.user_id = $1 AND rm.left_at IS NULL AND r.status = 'active';

-- name: ListBoards :many
SELECT b.id, b.name, b.created_by, b.created_at,
       count(p.id) FILTER (WHERE p.id IS NOT NULL)::int AS pin_count,
       count(p.id) FILTER (WHERE p.status = 'planned')::int AS planned_count
FROM boards b
LEFT JOIN pins p ON p.board_id = b.id AND p.deleted_at IS NULL
WHERE b.relationship_id = $1 AND b.archived_at IS NULL
GROUP BY b.id
ORDER BY max(coalesce(p.created_at, b.created_at)) DESC;

-- name: GetBoard :one
SELECT * FROM boards WHERE id = $1 AND relationship_id = $2 AND archived_at IS NULL;

-- name: CreateBoard :one
INSERT INTO boards (relationship_id, name, created_by) VALUES ($1, $2, $3) RETURNING *;

-- name: ListPins :many
SELECT * FROM pins WHERE board_id = $1 AND relationship_id = $2 AND deleted_at IS NULL
ORDER BY created_at DESC;

-- name: RecentPinsBy :many
-- What the other person saved lately ("New from Dev").
SELECT p.*, b.name AS board_name FROM pins p JOIN boards b ON b.id = p.board_id
WHERE p.relationship_id = $1 AND p.created_by = $2 AND p.deleted_at IS NULL AND p.created_at > $3
ORDER BY p.created_at DESC
LIMIT 10;

-- name: GetPin :one
SELECT p.*, b.name AS board_name FROM pins p JOIN boards b ON b.id = p.board_id
WHERE p.id = $1 AND p.relationship_id = $2 AND p.deleted_at IS NULL;

-- name: CreatePin :one
INSERT INTO pins (relationship_id, board_id, created_by, kind, title, url, note)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: UpdatePin :one
UPDATE pins SET
    title    = coalesce(sqlc.narg(title), title),
    note     = coalesce(sqlc.narg(note), note),
    status   = coalesce(sqlc.narg(status), status),
    board_id = coalesce(sqlc.narg(board_id), board_id),
    updated_at = now()
WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: DeletePin :execrows
UPDATE pins SET deleted_at = now() WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL;

-- name: RestorePin :execrows
-- Undo within a short window only.
UPDATE pins SET deleted_at = NULL
WHERE id = $1 AND relationship_id = $2 AND deleted_at > now() - interval '10 minutes';

-- name: ListPinNotes :many
SELECT n.id, n.author_id, n.body, n.created_at FROM pin_notes n
WHERE n.pin_id = $1 ORDER BY n.created_at;

-- name: CreatePinNote :one
INSERT INTO pin_notes (pin_id, author_id, body) VALUES ($1, $2, $3) RETURNING *;

-- name: SetTimeZone :exec
UPDATE users SET time_zone = $2, updated_at = now() WHERE id = $1;
