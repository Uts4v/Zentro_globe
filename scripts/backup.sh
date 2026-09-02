#!/usr/bin/env bash
#
# Zentro Postgres backup via pg_dump (custom-format, compressible).
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/backup.sh [DIR]
#
# Produces ./backups/zentro_<timestamp>.dump and prunes to the newest
# BACKUP_RETENTION dumps (default 14). Restore with scripts/restore.sh.
#
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
RETENTION="${BACKUP_RETENTION:-14}"
DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/zentro}"

# Parse postgres://user:pass@host:port/dbname
HOST="$(printf '%s' "$DATABASE_URL" | sed -E 's#postgres(ql)?://[^@]*@([^:/]+).*#\2#')"
PORT="$(printf '%s' "$DATABASE_URL" | sed -E 's#postgres(ql)?://[^@]*@([^:/]+):([0-9]+).*#\3#')"
DB="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*/([^/?]+).*#\1#')"
USERNAME="$(printf '%s' "$DATABASE_URL" | sed -E 's#postgres(ql)?://([^:]+):.*#\2#')"
PASSWORD="$(printf '%s' "$DATABASE_URL" | sed -E 's#postgres(ql)?://[^:]+:([^@]+)@.*#\2#')"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/zentro_${STAMP}.dump"

export PGPASSWORD="$PASSWORD"
pg_dump -h "$HOST" -p "${PORT:-5432}" -U "$USERNAME" -d "$DB" \
  --format=custom --no-owner --no-privileges \
  -f "$OUT"

echo "backup: $OUT"

# Prune old dumps, keep the newest $RETENTION
ls -1t "$BACKUP_DIR"/zentro_*.dump 2>/dev/null | tail -n +$((RETENTION + 1)) | xargs -r rm -f
echo "backups retained: $RETENTION"