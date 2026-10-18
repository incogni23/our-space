#!/usr/bin/env bash
# Runs a throwaway local Postgres 16 cluster in ./.devdb (no system service).
# Usage: scripts/dev-db.sh start|stop|status|url
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.devdb/data"
PORT="${BU_PG_PORT:-54329}"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
URL="postgres://betweenus@localhost:$PORT/betweenus?sslmode=disable"

case "${1:-}" in
  start)
    if [ ! -d "$DATA" ]; then
      mkdir -p "$ROOT/.devdb"
      "$PGBIN/initdb" -D "$DATA" -U betweenus --auth=trust -E UTF8 >/dev/null
    fi
    if ! "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      "$PGBIN/pg_ctl" -D "$DATA" -l "$ROOT/.devdb/postgres.log" -o "-p $PORT -c listen_addresses=localhost -c unix_socket_directories=''" -w start >/dev/null
    fi
    "$PGBIN/psql" -h localhost -p "$PORT" -U betweenus -d postgres -Atc \
      "SELECT 1 FROM pg_database WHERE datname='betweenus'" | grep -q 1 \
      || "$PGBIN/createdb" -h localhost -p "$PORT" -U betweenus betweenus
    echo "$URL"
    ;;
  stop)
    "$PGBIN/pg_ctl" -D "$DATA" -m fast stop
    ;;
  status)
    "$PGBIN/pg_ctl" -D "$DATA" status
    ;;
  url)
    echo "$URL"
    ;;
  *)
    echo "usage: $0 start|stop|status|url" >&2
    exit 2
    ;;
esac
