-- name: EnqueueJob :exec
-- Idempotent on dedupe_key while a job with that key is pending.
INSERT INTO jobs (kind, payload, run_at, dedupe_key, max_attempts)
VALUES ($1, $2, $3, sqlc.narg(dedupe_key), $4)
ON CONFLICT (dedupe_key) WHERE done_at IS NULL AND dedupe_key IS NOT NULL
DO UPDATE SET payload = EXCLUDED.payload, run_at = EXCLUDED.run_at;

-- name: CancelJobsByPrefix :exec
DELETE FROM jobs WHERE done_at IS NULL AND dedupe_key LIKE sqlc.arg(prefix)::text || '%';

-- name: ClaimJobs :many
UPDATE jobs SET locked_until = now() + interval '2 minutes', attempts = attempts + 1
WHERE id IN (
    SELECT id FROM jobs
    WHERE done_at IS NULL AND run_at <= now() AND (locked_until IS NULL OR locked_until < now())
    ORDER BY run_at
    LIMIT $1
    FOR UPDATE SKIP LOCKED
)
RETURNING id, kind, payload, attempts, max_attempts;

-- name: CompleteJob :exec
UPDATE jobs SET done_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1;

-- name: FailJob :exec
UPDATE jobs SET
    last_error = $2,
    locked_until = NULL,
    run_at = $3,
    done_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END
WHERE id = $1;
