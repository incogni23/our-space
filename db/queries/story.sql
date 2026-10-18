-- name: CreateMedia :one
INSERT INTO media (id, relationship_id, uploaded_by, width, height, bytes, key_full, key_thumb, taken_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetMedia :one
SELECT * FROM media WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL;

-- name: CountOwnMedia :one
-- Media ids that belong to this space (to validate a memory's photo list).
SELECT count(*) FROM media WHERE relationship_id = $1 AND id = ANY(@ids::uuid[]) AND deleted_at IS NULL;

-- name: CreateMemory :one
INSERT INTO memories (relationship_id, created_by, kind, title, caption, place, happened_on, ends_on)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: AttachMedia :exec
INSERT INTO memory_media (memory_id, media_id, position) VALUES ($1, $2, $3);

-- name: ListMemories :many
SELECT m.*,
       (SELECT count(*) FROM memory_media mm WHERE mm.memory_id = m.id)::int AS photo_count,
       coalesce((SELECT mm.media_id FROM memory_media mm WHERE mm.memory_id = m.id ORDER BY mm.position LIMIT 1), '00000000-0000-0000-0000-000000000000'::uuid)::uuid AS cover_id
FROM memories m
WHERE m.relationship_id = $1 AND m.deleted_at IS NULL
ORDER BY m.happened_on DESC, m.created_at DESC;

-- name: GetMemory :one
SELECT * FROM memories WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL;

-- name: MemoryMedia :many
SELECT md.id, md.width, md.height, md.taken_at, md.uploaded_by
FROM memory_media mm JOIN media md ON md.id = mm.media_id
WHERE mm.memory_id = $1 AND md.deleted_at IS NULL
ORDER BY mm.position;

-- name: DeleteMemory :execrows
UPDATE memories SET deleted_at = now() WHERE id = $1 AND relationship_id = $2 AND deleted_at IS NULL;

-- name: AllMemoriesWithMedia :many
-- For export: every memory and its photo keys.
SELECT m.id, m.kind, m.title, m.caption, m.place, m.happened_on, m.ends_on, md.id AS media_id, md.key_full, mm.position
FROM memories m
LEFT JOIN memory_media mm ON mm.memory_id = m.id
LEFT JOIN media md ON md.id = mm.media_id AND md.deleted_at IS NULL
WHERE m.relationship_id = $1 AND m.deleted_at IS NULL
ORDER BY m.happened_on, m.id, mm.position;

-- name: AllPins :many
SELECT p.*, b.name AS board_name FROM pins p JOIN boards b ON b.id = p.board_id
WHERE p.relationship_id = $1 AND p.deleted_at IS NULL ORDER BY b.name, p.created_at;

-- name: AllPlans :many
SELECT * FROM plans WHERE relationship_id = $1 ORDER BY starts_at;
