#!/usr/bin/env bash
# One-time database setup for the jewelry management system.
# Run as:  sudo bash scripts/setup_db.sh
set -euo pipefail

DB_USER="${DB_USER:-jewelry}"
DB_PASS="${DB_PASS:-jewelry123}"
DB_NAME="${DB_NAME:-jewelry}"
PG_PORT="${PG_PORT:-5433}"
SCHEMA="$(dirname "$0")/../db/schema.sql"

echo "==> Creating role '$DB_USER'"
su - postgres -c "psql -p $PG_PORT -v ON_ERROR_STOP=1 -c \"DO \\\$\\\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'; END IF; END \\\$\\\$;\""

echo "==> Creating database '$DB_NAME' (owner $DB_USER)"
su - postgres -c "psql -p $PG_PORT -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\" | grep -q 1 || createdb -p $PG_PORT -O $DB_USER $DB_NAME"

echo "==> Loading schema from $SCHEMA"
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p "$PG_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$SCHEMA"

echo "==> Done. DB ready at 127.0.0.1:$PG_PORT/$DB_NAME (user=$DB_USER)"
