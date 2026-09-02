# Backups — pg_dump / pg_restore

Status: **scripts shipped and backup→restore verified against Postgres 16
locally** (dump + restore into a fresh DB recovered all 57 tables). Scheduling
and off-site storage depend on the deploy environment.

## How to back up

```bash
DATABASE_URL=postgres://user:pass@host:5432/zentro ./scripts/backup.sh
```

Writes a `pg_dump` custom-format dump to `./backups/zentro_<timestamp>.dump`
and keeps the newest `BACKUP_RETENTION` dumps (default 14).

## How to restore

```bash
DATABASE_URL=postgres://user:pass@host:5432/zentro ./scripts/restore.sh ./backups/zentro_<timestamp>.dump
```

`pg_restore --clean --if-exists --single-transaction` — WARNING: this
overwrites the target database. Restore into a dedicated database first
(e.g. `zentro_staging`) when validating a restore.

## Verified (2026-09-02, local Postgres 16)

- `pg_dump` of `zentro_test` → 245,668-byte custom-format dump.
- `pg_restore` into a fresh `zentro_restore_test` → 57 public tables restored;
  drop of the throwaway DB afterward succeeded.

## Production checklist (deploy-dependent, not yet enforced here)

1. Schedule `backup.sh` via cron/systemd timer — at minimum daily, before any
   migration window.
2. Ship dumps off-host (object storage / S3 lifecycle with
   cross-region copy) — a dump on the same volume as the DB is not a backup.
3. Test restores on the staging DB at least monthly and record the SLO.
4. Keep `pg_restore --clean` elsewhere from running against production by
   mistake (separate credentials / a `SAFE_FOR_RESTORE` guard if desired).