#!/usr/bin/env bash
#
# Zentro Postgres restore from a pg_dump custom-format dump.
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/restore.sh PATH_TO_DUMP
#
# DANGER: this drops/recreates the target database schema. Run on a dedicated
# restore database (e.g. zentro_staging) or after confirming you want to
# overwrite the target.
#
set -euo pipefail

DUMP="${1:?usage: restore.sh <dump-file>}"
DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/zentro}"

[ -f "$DUMP" ] || { echo "dump not found: $DUMP" >&2; exit 1; }

HOST="$(printf '%s' "$DATABASE_URL" | sed -E 's#postgres(ql)?://[^@]*@([^:/]+).*#\2#')"
PORT="$(printf '%s' "$DATABASE_URL" | sed -E 's#postgres(ql)?://[^@]*@([^:/]+):([0-9]+).*#\3#')"
DB="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*/([^/?]+).*#\1#')"
USERNAME="$(printf '%s' "$DATABASE_URL" | sed -E 's#postgres(ql)?://([^:]+):.*#\2#')"
PASSWORD="$(printf '%s' "$DATABASE_URL" | sed -E 's#postgres(ql)?://[^:]+:([^@]+)@.*#\2#')"

export PGPASSWORD="$PASSWORD"
pg_restore -h "$HOST" -p "${PORT:-5432}" -U "$USERNAME" -d "$DB" \
  --clean --if-exists --no-owner --no-privileges \
  --single-transaction \
  "$DUMP"

echo "restore complete: $DUMP -> $DB"