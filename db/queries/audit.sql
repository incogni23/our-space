-- name: AddAuditEvent :exec
INSERT INTO audit_events (user_id, relationship_id, action, ip, detail) VALUES ($1, $2, $3, $4, $5);

-- name: RecentAuditEvents :many
SELECT action, created_at, detail FROM audit_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2;
