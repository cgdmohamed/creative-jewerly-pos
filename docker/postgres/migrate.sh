#!/bin/sh
set -eu

core_table="$(psql -v ON_ERROR_STOP=1 -Atqc "SELECT to_regclass('public.employees')")"

if [ -z "$core_table" ]; then
  public_tables="$(psql -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
  if [ "$public_tables" -ne 0 ]; then
    echo "Database is partially initialized: employees is missing but public tables exist." >&2
    echo "Refusing automatic initialization to protect existing data." >&2
    exit 1
  fi

  echo "Empty database detected; applying schema and initial staff accounts."
  psql -v ON_ERROR_STOP=1 -f /app-db/schema.sql
  psql -v ON_ERROR_STOP=1 -f /app-db/seed.sql
fi

for migration in /app-db/migrations/*.sql; do
  [ -e "$migration" ] || continue
  echo "Applying $migration"
  psql -v ON_ERROR_STOP=1 -f "$migration"
done
