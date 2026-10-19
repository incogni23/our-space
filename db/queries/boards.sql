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

-- name: SetPinPreviewPending :exec
UPDATE pins SET preview_status = 'pending' WHERE id = $1;

-- name: SetPinPreview :exec
-- Fills the preview; replaces the title only if it is still the default (the host name).
UPDATE pins SET
    preview_status = sqlc.arg(status),
    preview_site = sqlc.arg(site),
    preview_description = sqlc.arg(description),
    preview_media_id = sqlc.narg(media_id),
    title = CASE WHEN title = sqlc.arg(default_title)::text AND sqlc.arg(new_title)::text <> '' THEN sqlc.arg(new_title)::text ELSE title END,
    updated_at = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: ReadableSpaceFor :one
-- The space a user may read: their active space, or a closed one still inside its
-- read-only window (both former members can read and download until then).
SELECT r.id, r.name, r.status, r.read_only_until, r.palette FROM relationship_members rm
JOIN relationships r ON r.id = rm.relationship_id
WHERE rm.user_id = $1
  AND ((rm.left_at IS NULL AND r.status = 'active')
    OR (r.status = 'unlinked' AND r.read_only_until > now()))
ORDER BY (r.status = 'active') DESC, r.unlinked_at DESC NULLS LAST
LIMIT 1;

-- name: MembersOf :many
-- Everyone who was ever in the space (for read-only views after it closed).
SELECT u.id, u.display_name, u.person_tint, u.time_zone, u.ink, u.awake_from, u.awake_to
FROM relationship_members rm JOIN users u ON u.id = rm.user_id
WHERE rm.relationship_id = $1 ORDER BY rm.joined_at;

-- name: GetPinAny :one
-- For background jobs only (already scoped by the job's own payload).
SELECT * FROM pins WHERE id = $1 AND deleted_at IS NULL;

-- name: OldestUnplannedPin :one
-- For the empty Plans screen (5.2): "Little Ondu is still waiting for a date."
SELECT id, title, kind FROM pins
WHERE relationship_id = $1 AND deleted_at IS NULL AND status = 'saved' AND kind IN ('place', 'idea', 'link')
ORDER BY (kind = 'place') DESC, created_at
LIMIT 1;

-- name: CreatePhotoPin :one
INSERT INTO pins (relationship_id, board_id, created_by, kind, title, note, preview_status, preview_media_id)
VALUES (@relationship_id, @board_id, @created_by, 'photo', @title, @note, 'done', @media_id)
RETURNING *;
