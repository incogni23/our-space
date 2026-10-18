-- name: CreateTogether :one
INSERT INTO together_sessions (relationship_id, started_by, title, url, updated_by)
VALUES ($1, $2, $3, $4, $2)
RETURNING *;

-- name: OpenTogether :one
SELECT * FROM together_sessions WHERE relationship_id = $1 AND ended_at IS NULL;

-- name: GetTogether :one
SELECT * FROM together_sessions WHERE id = $1 AND relationship_id = $2;

-- name: GetTogetherForUpdate :one
SELECT * FROM together_sessions WHERE id = $1 AND relationship_id = $2 FOR UPDATE;

-- name: GetTogetherByID :one
SELECT * FROM together_sessions WHERE id = $1;

-- name: SetTogetherState :one
UPDATE together_sessions SET
    status = $3, position_ms = $4, position_at = $5, paused_reason = sqlc.narg(paused_reason),
    updated_by = sqlc.narg(updated_by), ended_at = sqlc.narg(ended_at)
WHERE id = $1 AND relationship_id = $2
RETURNING *;

-- name: PurgeTogether :exec
DELETE FROM together_sessions WHERE relationship_id = $1;
