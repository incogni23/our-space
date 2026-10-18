-- name: CreateNote :one
INSERT INTO notes (relationship_id, author_id, recipient_id, body, state, deliver_at, deliver_tz)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetNoteForUpdate :one
SELECT * FROM notes WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL FOR UPDATE;

-- name: GetNote :one
SELECT * FROM notes WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL;

-- name: UpdateNote :one
UPDATE notes SET body = $3, state = $4, deliver_at = $5, deliver_tz = $6, updated_at = now()
WHERE id = $1 AND relationship_id = $2 AND state <> 'delivered' AND deleted_at IS NULL
RETURNING *;

-- name: DeleteNote :execrows
-- Authors can take back drafts and scheduled notes; recipients can delete delivered ones.
UPDATE notes SET deleted_at = now()
WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL
  AND ((author_id = sqlc.arg(user_id) AND state <> 'delivered') OR (recipient_id = sqlc.arg(user_id) AND state = 'delivered'));

-- name: NotesFor :many
-- Everything a user may know about: notes they wrote, and notes to them.
SELECT * FROM notes
WHERE relationship_id = $1 AND deleted_at IS NULL
  AND (author_id = sqlc.arg(user_id) OR (recipient_id = sqlc.arg(user_id) AND state <> 'draft'))
ORDER BY coalesce(delivered_at, deliver_at, created_at) DESC;

-- name: DeliverNote :one
UPDATE notes SET state = 'delivered', delivered_at = now(), updated_at = now()
WHERE id = $1 AND state = 'scheduled' AND deliver_at <= now() + interval '5 seconds' AND deleted_at IS NULL
RETURNING *;

-- name: OpenNote :exec
UPDATE notes SET opened_at = coalesce(opened_at, now()) WHERE id = $1 AND recipient_id = $2 AND state = 'delivered';

-- name: KeepNote :exec
UPDATE notes SET kept = $3 WHERE id = $1 AND recipient_id = $2 AND state = 'delivered';

-- name: SetPlanRemind :exec
UPDATE plans SET remind = $3 WHERE id = $1 AND relationship_id = $2;

-- name: GetPlanByID :one
SELECT * FROM plans WHERE id = $1;

-- name: GetRelationship :one
SELECT * FROM relationships WHERE id = $1;

-- Purge: run in one transaction, in FK order, after LockPurgeable succeeds.

-- name: LockPurgeable :one
SELECT id FROM relationships
WHERE id = $1 AND status = 'unlinked' AND read_only_until <= now() AND purged_at IS NULL
FOR UPDATE;

-- name: PurgeNotes :exec
DELETE FROM notes WHERE relationship_id = $1;

-- name: PurgePinNotes :exec
DELETE FROM pin_notes WHERE pin_id IN (SELECT id FROM pins WHERE relationship_id = $1);

-- name: PurgeMemoryMedia :exec
DELETE FROM memory_media WHERE memory_id IN (SELECT id FROM memories WHERE relationship_id = $1);

-- name: PurgePlans :exec
DELETE FROM plans WHERE relationship_id = $1;

-- name: PurgeMemories :exec
DELETE FROM memories WHERE relationship_id = $1;

-- name: PurgePins :exec
DELETE FROM pins WHERE relationship_id = $1;

-- name: PurgeBoards :exec
DELETE FROM boards WHERE relationship_id = $1;

-- name: PurgeMedia :many
DELETE FROM media WHERE relationship_id = $1 RETURNING key_full, key_thumb;

-- name: MarkPurged :exec
UPDATE relationships SET purged_at = now() WHERE id = $1;
