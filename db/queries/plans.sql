-- name: CreatePlan :one
INSERT INTO plans (relationship_id, created_by, pin_id, kind, title, place, notes, starts_at, anchor_tz, repeat, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: GetPlan :one
SELECT * FROM plans WHERE id = $1 AND relationship_id = $2;

-- name: GetPlanForUpdate :one
SELECT * FROM plans WHERE id = $1 AND relationship_id = $2 FOR UPDATE;

-- name: LivePlans :many
-- One-offs from `from` onward, and every weekly plan that started before `to`.
SELECT * FROM plans
WHERE relationship_id = $1 AND status IN ('proposed', 'confirmed')
  AND ((repeat = 'none' AND starts_at >= sqlc.arg(from_at) AND starts_at < sqlc.arg(to_at))
    OR (repeat = 'weekly' AND starts_at < sqlc.arg(to_at)))
ORDER BY starts_at;

-- name: RespondToPlan :one
UPDATE plans SET
    status = $3,
    responded_by = $4,
    responded_at = now(),
    suggested_starts_at = sqlc.narg(suggested_starts_at),
    suggested_by = sqlc.narg(suggested_by),
    updated_at = now()
WHERE id = $1 AND relationship_id = $2
RETURNING *;

-- name: AcceptSuggestion :one
UPDATE plans SET
    starts_at = suggested_starts_at,
    suggested_starts_at = NULL,
    suggested_by = NULL,
    status = 'confirmed',
    responded_by = $3,
    responded_at = now(),
    updated_at = now()
WHERE id = $1 AND relationship_id = $2 AND suggested_starts_at IS NOT NULL
RETURNING *;

-- name: EditPlan :one
UPDATE plans SET
    title = $3, place = $4, notes = $5, starts_at = $6, anchor_tz = $7, repeat = $8, status = $9,
    suggested_starts_at = NULL, suggested_by = NULL, updated_at = now()
WHERE id = $1 AND relationship_id = $2
RETURNING *;

-- name: CancelPlan :execrows
UPDATE plans SET status = 'cancelled', updated_at = now()
WHERE id = $1 AND relationship_id = $2 AND status IN ('proposed', 'confirmed');

-- name: MarkPinPlanned :exec
UPDATE pins SET status = 'planned', updated_at = now()
WHERE id = $1 AND relationship_id = $2 AND status = 'saved';

-- name: AddPlanEvent :exec
INSERT INTO plan_events (plan_id, user_id, action, at_time) VALUES ($1, $2, $3, $4);

-- name: PlanEvents :many
SELECT user_id, action, at_time, created_at FROM plan_events WHERE plan_id = $1 ORDER BY id;

-- name: HistoryPlans :many
-- Everything that's over: past one-offs, and anything declined or cancelled.
SELECT * FROM plans
WHERE relationship_id = $1
  AND (status IN ('declined', 'cancelled') OR (repeat = 'none' AND starts_at < now() - interval '2 hours'))
ORDER BY coalesce(responded_at, updated_at, starts_at) DESC
LIMIT 300;
