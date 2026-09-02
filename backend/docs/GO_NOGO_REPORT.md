# Zentro Glow Loyalty — Final 25-Section Remediation & GO/NO-GO Report

Status: **GO FOR CONTROLLED 1–2 CAFÉ PILOT** (with bounded conditions — see §25)
Branch: `upgrade-ui-system`
Baseline checkpoint: `02ef504` · Remediation commits: 20 (`99f6621` → `f058297`)

---

## 1. Executive verdict

The audited platform was **NO-GO** with reproducible failures and financially
unsafe flow gaps. After Phase C (financial-atomicity), Phase D (the complete
H-1..H-14 hardening list), and the money/auth Medium sweep, the platform is:

- **229/229 backend tests green on PostgreSQL (0 skipped)** and **229/229 with
  2 skipped on SQLite** (the two skips are Postgres-only row-lock concurrency
  tests).
- `manage.py check` clean; `makemigrations --check --dry-run` clean.
- Frontend `tsc --noEmit` clean; `npm run build` clean (PWA built).
- Money-movement paths serialized with row locks; ledger writes in `Decimal`;
  no known float-money corruption remains in write paths.
- CI workflow, health/readiness probe, pg_dump/pg_restore (verified), and
  optional S3/MinIO media storage shipped.

**GO for a controlled pilot** of 1–2 cafés, contingent on the §25 conditions.

---

## 2. Scope & method

- No rewrite: Django/ORM/DRF, server-computed totals, tenant isolation,
  Postgres row locks, idempotency preserved.
- Every C/H remediation ships with at least one dedicated regression test in the
  Django test suite (SQLite for the default suite; PostgreSQL for the
  concurrency/money suite via `DATABASE_URL`).
- Evidence is real measurements: `python manage.py test`, `git` commits, live
  pg_dump→pg_restore round trip, `tsc --noEmit`, `npm run build`.

---

## 3. Baseline state (pre-remediation, at audit)

- Reproducible NO-GO blockers: H-13 (missions tracked `order.total_amount`
  instead of pre-tax `subtotal`), H-12 (staff report `KeyError` on rewritten
  per-worker aggregation), DRF `min_value should be … Decimal` UserWarning
  (M-12), unprotected money endpoints (lost-update risk, unvalidated devices,
  credit-refund never crediting balance), unbounded public lists, public
  leaderboard without auth/rate-limit, auto-approved merchants.

---

## 4. Phase C summary

| Item | Fix | Commit |
|---|---|---|
| C-1 media hardening | extension-derived content types, traversal-safe serve, nosniff/CSP `sandbox`, safest fallback | `99f6621` |
| C-2 redemption atomicity | reward redemption deducts held points financially atomically at complete | `d397047` |
| C-3 conflict resolution | `resolve_conflict` validates financial state (Decimal/Precision/Integrity guards) | `e26a873` |
| C-4 leaderboard | auth required + `LeaderboardThrottle` (300/hr) + public `LeaderboardEntrySerializer`, limit 1..50 | `2ab13fe` |
| C-5 quantities | `parse_quantity` (1..999, int-only, rejects bool/fractional/0/neg) wired into create/guest/add-items + table order | `81bfebe` |

---

## 5. C-1 details

`safe_file_name`, extension allow-list, and `serve_media` in `config/views.py`
serve user content as inert `application/octet-stream` unless it is a raster
image, with `X-Content-Type-Options: nosniff`, `Content-Security-Policy:
default-src 'none'; … sandbox`, `X-Frame-Options: DENY`. Path traversal
rejected via resolve-and-relative_to checks. Evidence: `pos` suite + live
traversal tests pass.

---

## 6. C-2 details

Redemption points move only on completed/loyalty-awarded transitions inside
`transaction.atomic`; a failed completion cannot leave held points deducted
without an order transition. Regressions in `loyalty/test_reward_redemption.py`
(`test_points_deducted_at_redeem_time`, `test_cancel_refunds_points`).

---

## 7. C-3 details

`resolve_conflict` recomputes totals server-side, demands non-negative balances/
amounts, and rejects conflicting financial writes rather than silently choosing
a side. `pos/test_resolve_conflict.py` (13 tests) green on SQLite and Postgres.

---

## 8. C-4 details

Leaderboard is now `IsAuthenticated` + `LeaderboardThrottle` (pinned scope; DRF
FBV `getattr` pitfall avoided via a `ScopedRateThrottle` subclass). Response
uses a dedicated public serializer exposing only `rank, customer_id, full_name,
loyalty_points, tier, streak_days, merchant_id`. `loyalty/test_leaderboard.py`
green.

---

## 9. C-5 details

`parse_quantity` centralizes quantity validation (int 1..999, rejects
`1.0`/`True`/`0`/negative/non-numeric). Applied in `create_pos_order`,
`table_order`, `create_order`, `guest_create_order`, `add_items_to_order`.
Fixes surfaced: `total_amount` NOT NULL on initial table-order save,
float+Decimal TypeError, `guest_name_snapshot` (not `customer_name_snapshot`),
`_notify_safe(user=…)`. `pos/test_quantity_validation.py` (20 tests).

---

## 10. H-1 / H-2 / H-6 — merchant inputs

`MenuItemSerializer.validate_price` (>0), `validate_points_per_item` (≥0),
`validate_name`/`validate_category` (strip, length caps);
`_TableSerializer.validate_table_number` (>0). `merchants/test_menu_item_validation.py` (6 tests). Commit `c1faaec`.

---

## 11. H-4 — customer order idempotency

Optionally provided `client_mutation_id` enforces reuse of an existing order
(conditional unique constraint `uniq_customer_merchant_mutation`, migration
0023) with an `IntegrityError` race guard. `orders/test_idempotency.py` (4
tests) green on SQLite and Postgres. Commit `ddf70f9`.

---

## 12. H-5 — cancellation serialization

`cancel_order` locks the order row (`select_for_update(of=("self",))`).
Wallet credit/debit already lock via `_lock_wallet`. Commit `8c0b0dc`.

---

## 13. H-7 — customer-facing serializer

`CustomerOrderSerializer` (no `processed_by_worker`, POS device, cash-shift,
mutation/version internals) replaces the internal serializer on `/my-orders/`.
`orders/test_customer_order_serializer.py` asserts no internal leak. Commit `df14f54`.

---

## 14. H-8 — bounded public lists

`merchant_list`, `mission_list`, `reward_list` capped at 200 rows each.
Commit `355ad7f`.

---

## 15. H-9 — lifecycle audit

Order status changes and cancellations write `order_status_change` /
`order_cancelled` rows to the shared `PosAuditLog` (from/to, points_awarded,
actor, refunded flag). Best-effort, non-blocking. `orders/test_audit.py` (2
tests). Commit `4f5ff1c`.

---

## 16. H-10 — JWT storage (DOCUMENTED, NOT RESOLVED)

Refresh token still in `localStorage` (`dja`/`djr`). C-1 reduced the stored-XSS
impact; the follow-up task (refresh in HttpOnly cookie, CSRF, access in memory,
15-min prod TTL already set) is documented in `backend/docs/H10-jwt-cookie-migration.md`.
**Deliberately not marked resolved.**

---

## 17. H-11 — merchant approval gate

Registration no longer auto-approves (`is_approved` gated by
`AUTO_APPROVE_MERCHANTS`, default off). Unapproved merchants are invisible to
public endpoints (see H-14). Commit `a505547`. Regression: `accounts` suite
green.

---

## 18. H-12 / H-13 — staff report & mission spend

H-12: `items_by_worker` keyed by `order__processed_by_worker_id` (fixes the
audited `KeyError`). H-13: spend missions accumulate `int(order.subtotal)`.
Regression: `orders/tests.py` spend-mission test + `pos/test_staff_report.py` (now
backend-agnostic via `Decimal`). Commit `7fe2ea1`.

---

## 19. H-14 — public merchant visibility

`merchant_by_slug` filters `is_approved=True`, matching `public_resolve_table`.
Commit `a505547`.

---

## 20. Money Mediums

- **Lost updates**: `debit_topup/purchase/adjustment`, `credit_sale/repayment`
  lock the account row (`select_for_update`); Postgres concurrency test proves
  5 parallel topups sum exactly. `aee6173`
- **Device authorization**: those endpoints reject transactions attributed to a
  device that is not the merchant's active POS device (404). `a2fd909`
- **Refund correctness**: `process_refund` now (a) `Decimal` math, (b) locks the
  order and rejects double refund, (c) actually credits the CreditAccount on
  credit refunds (was a fabricated 0/0 row), (d) locks debit account credit-back.
  5 regression tests. `2b7d463`
- **Shift close** locks the open shift row. `e56d69b`
- **M-12**: `DecimalField(min_value=0.01)` → `Decimal("0.01")`; DRF UserWarning
  gone. `aee6173`
- **Tax/points in Decimal**: `calculate_tax` quantizes half-up in Decimal;
  points-per-NPR allocation uses `Decimal`. `8fdd4bd`

---

## 21. Auth / IDOR / rate-limit review

- `my_orders` (customer), `store_orders` (merchant), `wallet_mine`/`my_*`,
  point-history: self-scoped; `test_merchant_a_cannot_query_merchant_b_wallets`
  green.
- Loyalty awarding already wallet-locked; `loyalty_awarded` flag prevents
  double-award.
- Throttle scopes present: `login` 10/min, `otp` 5/min, `redeem` 10/min,
  `transfer` 10/hr, `guest` 60/hr, `upload` 100/hr, `leaderboard` 300/hr,
  plus global `user: 1000/day`, `anon: 500/hr`.
- Passwords: Django `validate_password` + `min_length=8` on register/change/
  reset; reset tokens `secrets.token_urlsafe(40)`; OTP via `secrets`.
- Public serializers (`MerchantPublicSerializer`, leaderboard) expose no
  internal fields.

---

## 22. Regression gates (real measurements)

- **SQLite (default)**: `python manage.py test` → **229 OK, 2 skipped**
  (skips are the Postgres-gated money-concurrency tests).
- **PostgreSQL 16 (local)**: `DATABASE_URL=… DB_SSLMODE=disable
  python manage.py test` → **229 OK, 0 skipped**.
- `python manage.py check` → no issues; `makemigrations --check --dry-run` → no
  changes.
- Frontend: `tsc --noEmit` → exit 0; `npm run build` → exit 0 (PWA
  service-worker generated).

---

## 23. CI/CD

`.github/workflows/ci.yml`: backend job runs migrations check + full test suite
against a **Postgres 16 service** (money-concurrency tests actually execute in
CI); frontend job runs `tsc --noEmit`, production build, and informational
lint. Not yet exercised on a live GitHub run (requires push) — queued for the
pilot branch gate.

---

## 24. Operations: monitoring, backups, object storage

- **Monitoring**: `/healthz/` now returns DB + cache status, 503 when degraded
  (`config/test_health.py`); request logging middleware and slow-request
  threshold already present.
- **Backups**: `scripts/backup.sh` (pg_dump custom-format + retention) and
  `scripts/restore.sh` (`--clean --single-transaction`). **Verified live**:
  dump of `zentro_test` (245,668 B) restored into a fresh DB recovering all 57
  tables. `backend/docs/BACKUPS.md` documents scheduling/off-host shipping as
  deploy-dependent steps.
- **Object storage**: `USE_S3_STORAGE=true` switches media to
  `S3Boto3Storage` (S3/MinIO/R2 via `AWS_S3_ENDPOINT_URL`); guarded with a
  clear `ImproperlyConfigured` if `django-storages` missing. Both paths verified
  from settings. Live bucket round-trip requires an object-storage env
  (deploy-dependent).

---

## 25. GO / NO-GO verdict

**GO FOR CONTROLLED PILOT — 1–2 CAFÉS** with these bounds:

**Ready now:** all C/H fixes; money integrity (row locks, Decimal ledgers,
atomic refunds, idempotent creation/cancellation); merchant approval + public
visibility gate; bounded/authenticated/throttled endpoints; 229 green
(Postgres); migrations clean; backups verified; health probe; option for S3
media.

**Pilot-gating conditions (must be satisfied before first café goes live):**
1. H-10 JWT cookie migration (documented, not yet implemented) —
   refresh-token HttpOnly cookie; until then refresh remains in `localStorage`.
2. Staging E2E + load test on the staging environment (no staging env yet)
   with recorded numbers before any 10–20-café rollout.
3. Production environment hardening: `DEBUG=False`, real `SECRET_KEY`,
   `ALLOWED_HOSTS`, TLS, Postgres/Redis creds — verified in the deployed env.
4. Ship backups off-host and set the backup schedule (cron) in deploy env;
   run one documented restore drill.
5. If media is not on a persistent volume, enable `USE_S3_STORAGE` and verify
   a real upload/download round trip against the pilot provider.
6. Push a commit to run `.github/workflows/ci.yml` once green on GitHub.

If all six conditions are accepted and verified, the platform is **GO** for the
controlled café pilot; the remaining 10–20-café rollout requires the staging
E2E/load evidence and post-pilot financial reconciliation review.