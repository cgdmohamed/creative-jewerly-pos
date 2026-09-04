#!/usr/bin/env bash
# Reset the database to a clean, seeded state (drops schema, re-applies).
# Requires DB credentials from env or defaults (jewelry / jewelry123).
set -euo pipefail
DB_USER="${DB_USER:-jewelry}"
DB_PASS="${DB_PASS:-jewelry123}"
DB_NAME="${DB_NAME:-jewelry}"
PG_PORT="${PG_PORT:-5433}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

export PGPASSWORD="$DB_PASS"
psql -h 127.0.0.1 -p "$PG_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" > /dev/null
psql -h 127.0.0.1 -p "$PG_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$ROOT/db/schema.sql" > /dev/null
psql -h 127.0.0.1 -p "$PG_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$ROOT/db/seed.sql" > /dev/null
echo "DB reset complete (user=$DB_USER db=$DB_NAME port=$PG_PORT)"
