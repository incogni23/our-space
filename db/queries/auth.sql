-- name: CountVerificationsByPhoneSince :one
SELECT count(*) FROM phone_verifications WHERE phone_e164 = $1 AND created_at > $2;

-- name: CountVerificationsByIPSince :one
SELECT count(*) FROM phone_verifications WHERE request_ip = $1 AND created_at > $2;

-- name: LatestVerificationAt :one
SELECT created_at FROM phone_verifications WHERE phone_e164 = $1 ORDER BY created_at DESC LIMIT 1;

-- name: CreateVerification :one
INSERT INTO phone_verifications
    (phone_e164, purpose, user_id, provider, provider_ref, code_hash, request_ip, created_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetVerificationForUpdate :one
SELECT * FROM phone_verifications WHERE id = $1 FOR UPDATE;

-- name: UpdateVerification :exec
UPDATE phone_verifications SET status = $2, attempts = $3, completed_at = $4 WHERE id = $1;

-- name: ConsumeVerification :execrows
-- Spend an approved, unexpired-for-use verification once.
UPDATE phone_verifications
SET consumed_at = $5
WHERE id = $1 AND user_id = $2 AND purpose = $3 AND phone_e164 = $6 AND status = 'approved'
  AND consumed_at IS NULL AND completed_at > $4;

-- name: CreateSession :one
INSERT INTO sessions (user_id, token_hash, device_hash, device_label, status, created_at, last_seen_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
RETURNING *;

-- name: GetSessionByToken :one
SELECT * FROM sessions WHERE token_hash = $1;

-- name: GetSessionByTokenForUpdate :one
SELECT * FROM sessions WHERE token_hash = $1 FOR UPDATE;

-- name: SetSessionStatus :exec
UPDATE sessions SET status = $2 WHERE id = $1;

-- name: TouchSession :exec
UPDATE sessions SET last_seen_at = $2 WHERE id = $1;

-- name: RevokeUserSessions :exec
UPDATE sessions SET status = 'revoked' WHERE user_id = $1 AND status <> 'revoked';

-- name: DeviceTrusted :one
-- A device is trusted once a fully signed-in session has existed on it.
SELECT EXISTS (
    SELECT 1 FROM sessions
    WHERE user_id = $1 AND device_hash = $2 AND status IN ('active', 'revoked')
      AND device_hash <> '\x'::bytea
) AS trusted;

-- name: UserHasHistory :one
-- Anything worth protecting: the account has ever been part of a space.
SELECT EXISTS (SELECT 1 FROM relationship_members WHERE user_id = $1) AS has_history;

-- name: DeleteUnusedRecoveryCodes :exec
DELETE FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL;

-- name: InsertRecoveryCode :exec
INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES ($1, $2, $3);

-- name: UseRecoveryCode :execrows
UPDATE recovery_codes SET used_at = $3 WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL;

-- name: CountUnusedRecoveryCodes :one
SELECT count(*) FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL;

-- name: SetUserPhone :exec
UPDATE users SET phone_e164 = $2, phone_verified_at = $3, updated_at = $3 WHERE id = $1;

-- name: ReleaseUserPhone :exec
UPDATE users SET phone_e164 = NULL, updated_at = $2 WHERE id = $1;

-- name: UpdateProfile :one
UPDATE users SET display_name = $2, person_tint = $3, updated_at = $4 WHERE id = $1
RETURNING *;

-- name: GetUserForUpdate :one
SELECT * FROM users WHERE id = $1 FOR UPDATE;

-- name: GetUserByPhoneForUpdate :one
SELECT * FROM users WHERE phone_e164 = $1 FOR UPDATE;
