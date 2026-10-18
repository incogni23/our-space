# Between Us

A little world for two. See [todo.md](todo.md) for the plan and the design canvas for screens.

## Run locally

Requirements: Go 1.25, Node 20 + pnpm, Postgres 16 (Homebrew `postgresql@16`), sqlc, goose.

```sh
# 1. Database (throwaway cluster in ./.devdb, port 54329)
scripts/dev-db.sh start

# 2. API on :8080 — migrates on start; dev OTP codes are printed to the log
DATABASE_URL="$(scripts/dev-db.sh url)" DEV_FIXED_OTP=123456 go run ./api/cmd/api

# 3. Web on :3000 — proxies /api to the Go service
cd web && pnpm install && pnpm dev
```

Open http://localhost:3000. With `DEV_FIXED_OTP=123456` every phone code is `123456`.
To try pairing, use a second browser profile (or a private window) for the partner.

## Layout

```
api/cmd/api          HTTP server entrypoint
api/internal/auth    phone codes, sessions, devices, recovery codes, number change
api/internal/pairing two people, one space: create, invite, accept, decline, leave
api/internal/httpapi JSON API under /api/v1
api/internal/store   sqlc-generated queries (do not edit; run `sqlc generate`)
db/migrations        goose SQL migrations (invariants live here too)
db/queries           sqlc query files
design/              tokens.json, tokens.css
web/                 Next.js app
```

## Environment (API)

| Var | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | — | required |
| `ADDR` | `:8080` | |
| `APP_ENV` | `development` | `production` enables secure cookies and refuses the dev OTP provider |
| `AUTH_PEPPER` | dev value | required in production; keys stored code hashes |
| `OTP_PROVIDER` | `dev` | |
| `DEV_FIXED_OTP` | — | dev only |
| `APP_ORIGIN` | `http://localhost:3000` | used in invite links |
| `TRUST_PROXY` | `false` | read client IP from `X-Forwarded-For` |
| `MIGRATE_ON_START` | `true` | |
| `MEDIA_STORE` | `fs` | `fs` (local folder) or `s3` (MinIO, AWS S3, Cloudflare R2…) |
| `MEDIA_DIR` | `.devdb/media` | for `fs` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_USE_SSL` | — | for `s3`; endpoint is host[:port], e.g. `localhost:9000` for MinIO |

## Tests

```sh
BU_TEST_DATABASE_URL="$(scripts/dev-db.sh url)" go test ./...
```
