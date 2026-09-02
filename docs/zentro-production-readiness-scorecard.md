# Zentro Glow Loyalty — Production Readiness Scorecard

## Baseline vs Current State

| Field | Baseline (original audit) | Current |
|---|---|---|
| Commit | `afb3f94` (2026-07-29) | `0d6c4c7` (2026-09-02) |
| Backend tests | 114 OK (SQLite only) | **232 OK** (SQLite + PostgreSQL) |
| Frontend build | Pass (type errors ignored) | **Pass** (tsc clean + build clean) |
| CI/CD | None | **GitHub Actions green** |
| Branch | `upgrade-ui-system` | `upgrade-ui-system` |

---

## Scoring Methodology

- **1–3**: Critical gaps; unacceptable for production
- **4–5**: Functional but fragile; risky under load/adversary
- **6–7**: Solid for pilot; needs hardening for scale
- **8–9**: Production-grade; minor gaps remain
- **10**: Fully battle-tested

---

## 1. Security

| Sub-area | Baseline | Now | Δ | Notes |
|---|:---:|:---:|:---:|---|
| Authentication (JWT) | 5 | 6 | +1 | Access/refresh flow works; refresh still in localStorage (H-10 not implemented) |
| Password strength | 4 | 7 | +3 | Django `validate_password` + `min_length=8` on register/change/reset; reset tokens `secrets.token_urlsafe(40)` |
| Role enforcement | 7 | 7 | 0 | Customer/merchant separation enforced at login + serializer |
| Merchant approval | 3 | 6 | +3 | H-11: `AUTO_APPROVE_MERCHANTS` env gate (default off); public endpoints filter `is_approved=True` |
| IDOR protection | 4 | 8 | +4 | My-orders, wallet, loyalty, store-orders all self-scoped; `test_merchant_a_cannot_query_merchant_b_wallets` green |
| Rate limiting | 3 | 7 | +4 | Throttles on login (10/min), OTP (5/min), redeem (10/min), transfer (10/hr), leaderboard (300/hr), global 1000/day; POS device endpoints exempt |
| Input validation | 5 | 8 | +3 | H-1/H-2/H-6: price >0, points ≥0, name/category strip+length, table_number >0; C-5: quantity int 1..999 |
| File upload security | 3 | 7 | +4 | C-1: extension allow-list, content-type sniffing, nosniff/CSP sandbox, traversal rejection, safest fallback |
| JWT storage | 3 | 3 | 0 | Refresh + access in localStorage; H-10 documented, not implemented |
| Admin exposure | 5 | 5 | 0 | Django admin at `/admin/`; no IP restriction |
| **Average** | **4.2** | **6.3** | **+2.1** | |

---

## 2. Money / Financial Integrity

| Sub-area | Baseline | Now | Δ | Notes |
|---|:---:|:---:|:---:|---|
| Lost-update protection | 2 | 8 | +6 | `select_for_update` on credit_sale, credit_repayment, debit_topup, debit_purchase, debit_adjustment; Postgres concurrency test proves 5 parallel topups sum exact |
| Refund correctness | 2 | 8 | +6 | `process_refund`: Decimal math, order row lock, rejects double refund, credit refund actually credits balance, debit refund locks row; 5 regression tests |
| Tax computation | 4 | 8 | +4 | `calculate_tax` rewritten to pure Decimal with `ROUND_HALF_UP`; no float round-trips in write paths |
| Points allocation | 4 | 7 | +3 | `int(Decimal(str(x)) * points_per_npr)` — no float in points calculation |
| Device authorization | 3 | 7 | +4 | `_resolve_pos_device` validates X-Pos-Device-Id against merchant's active devices; 4 money endpoints reject foreign devices |
| M-12 DRF type safety | 2 | 8 | +6 | `DecimalField(min_value=Decimal("0.01"))`; DRF UserWarning gone |
| Shift close integrity | 3 | 7 | +4 | Row lock on close_shift prevents concurrent close races |
| Idempotent creation | 4 | 8 | +4 | H-4: `client_mutation_id` with conditional unique constraint + IntegrityError race guard; green on both DBs |
| Cancellation atomicity | 3 | 7 | +4 | H-5: order row lock + wallet lock on cancel |
| **Average** | **3.0** | **7.4** | **+4.4** | |

---

## 3. API Hardening

| Sub-area | Baseline | Now | Δ | Notes |
|---|:---:|:---:|:---:|---|
| Public list bounds | 3 | 7 | +4 | H-8: merchant_list, mission_list, reward_list capped at 200 rows |
| Customer serializer split | 5 | 8 | +3 | H-7: `CustomerOrderSerializer` hides POS internals (processed_by_worker, device, cash_shift, mutation) |
| Audit logging | 2 | 6 | +4 | H-9: order status changes + cancellations write to `PosAuditLog`; best-effort, non-blocking |
| Conflict resolution | 3 | 7 | +4 | C-3: `resolve_conflict` validates financial state with Decimal/Precision/Integrity checks; 13 tests |
| Leaderboard auth | 3 | 8 | +5 | C-4: `IsAuthenticated` + `LeaderboardThrottle` + public serializer (no internal fields) |
| Slug visibility alignment | 3 | 6 | +3 | H-14: `merchant_by_slug` filters `is_approved=True`, matching `public_resolve_table` |
| **Average** | **3.2** | **7.0** | **+3.8** | |

---

## 4. Testing

| Sub-area | Baseline | Now | Δ | Notes |
|---|:---:|:---:|:---:|---|
| Test count | 3 | 8 | +5 | 114 → 232 tests (103% increase) |
| PostgreSQL coverage | 2 | 8 | +6 | Zero Postgres-specific tests → 232 pass on Postgres 16; money concurrency tests Postgres-gated |
| Money tests | 1 | 8 | +7 | Concurrency (5 parallel topups), refund (5 tests), device auth (3 tests), Decimal tax, idempotency (4 tests) |
| IDOR/permission tests | 2 | 7 | +5 | Merchant-scoped wallet test, self-scoped order test, staff-report auth test |
| N+1 regression guards | 0 | 7 | +7 | Query-count guards for store_orders, my_orders, leaderboard; negative control proves sensitivity (delta 0 vs 72) |
| Frontend tests | 0 | 1 | +1 | tsc + build pass; zero unit/integration/E2E tests |
| **Average** | **1.3** | **6.5** | **+5.2** | |

---

## 5. CI/CD

| Sub-area | Baseline | Now | Δ | Notes |
|---|:---:|:---:|:---:|---|
| Backend CI | 0 | 8 | +8 | Postgres 16 service, `makemigrations --check`, full test suite, verified green (run 33616357630) |
| Frontend CI | 0 | 7 | +7 | npm ci, tsc --noEmit, production build; lint informational (continue-on-error) |
| Migrations guard | 0 | 8 | +8 | `makemigrations --check --dry-run` runs under DEBUG=False (production import path) |
| Deployment pipeline | 0 | 3 | +3 | CI exists but no CD; deploy to Railway/Vercel is manual |
| **Average** | **0.0** | **6.5** | **+6.5** | |

---

## 6. Infrastructure & Operations

| Sub-area | Baseline | Now | Δ | Notes |
|---|:---:|:---:|:---:|---|
| Health check | 3 | 7 | +4 | `/healthz/` now checks DB + cache; returns 503 when degraded; `config/test_health.py` |
| Backups | 1 | 6 | +5 | `scripts/backup.sh` (pg_dump + retention) + `scripts/restore.sh`; verified pg_dump→pg_restore (57 tables, 245KB); off-host scheduling not wired |
| Object storage | 1 | 6 | +5 | `USE_S3_STORAGE=true` switches to `S3Boto3Storage`; `ImproperlyConfigured` guard; verified both paths; no live bucket round-trip |
| Request logging | 4 | 6 | +2 | `RequestContextMiddleware` (request_id, duration, status, user); slow-request WARNING threshold |
| Error tracking | 0 | 1 | +1 | No Sentry/Bugsnag/Rollbar; errors disappear into logs |
| Monitoring/alerts | 0 | 1 | +1 | No Prometheus/Grafana/Datadog; no alerting |
| **Average** | **1.5** | **4.5** | **+3.0** | |

---

## 7. Frontend Quality

| Sub-area | Baseline | Now | Δ | Notes |
|---|:---:|:---:|:---:|---|
| TypeScript | 3 | 7 | +4 | tsc --noEmit passes (nitro `publicAssets` type mismatch fixed with `as any` cast) |
| Production build | 7 | 8 | +1 | Build passes; PWA service-worker generated; code-splitting (react, radix, tanstack chunks) |
| Unit tests | 0 | 0 | 0 | No component/store/hook tests |
| E2E tests | 0 | 0 | 0 | No Playwright/Cypress |
| **Average** | **2.5** | **3.8** | **+1.3** | |

---

## 8. Production Readiness

| Sub-area | Baseline | Now | Δ | Notes |
|---|:---:|:---:|:---:|---|
| DEBUG=False hardening | 3 | 5 | +2 | SSL redirect, HSTS, secure cookies configured; but CI runs DEBUG=True (validated config only) |
| SECRET_KEY mgmt | 3 | 5 | +2 | Env-gated; raises RuntimeError if missing in prod; but no key rotation policy |
| ALLOWED_HOSTS | 3 | 4 | +1 | Falls back to `localhost,127.0.0.1`; Railway domain auto-appended; needs real config per env |
| CSRF trusted origins | 3 | 4 | +1 | Railway domain auto-appended; needs real domain config |
| WebSocket (Redis) | 3 | 3 | 0 | Channel layer in-memory; production needs Redis; no test coverage |
| Celery worker health | 2 | 2 | 0 | Celery configured but no heartbeat monitoring or dead-worker restart |
| Connection pooling | 2 | 2 | 0 | No `CONN_MAX_AGE`; each request opens/closes |
| **Average** | **2.7** | **3.6** | **+0.9** | |

---

## 9. Data Integrity & Isolation

| Sub-area | Baseline | Now | Δ | Notes |
|---|:---:|:---:|:---:|---|
| Merchant isolation | 7 | 8 | +1 | All merchant data filtered server-side; test confirms cross-merchant blocked |
| Customer isolation | 7 | 8 | +1 | my-orders, wallet, loyalty all resolve customer from auth; not from request body |
| Cross-merchant loyalty | 7 | 8 | +1 | Wallets per customer+merchant; transfers same-merchant only; test-verified |
| Staff scoping | 6 | 7 | +1 | Permission flags gate discounts/refunds/shift-close/reports; POS device auth validated |
| Guest session isolation | 6 | 6 | 0 | Guest orders tied to `guest_session_id`; no account created; no cross-guest leakage |
| **Average** | **6.6** | **7.4** | **+0.8** | |

---

## Overall Score Summary

| Category | Weight | Baseline | Now | Δ |
|---|:---:|:---:|:---:|:---:|
| Security | 25% | 4.2 | **6.3** | +2.1 |
| Money/Financial Integrity | 20% | 3.0 | **7.4** | +4.4 |
| API Hardening | 10% | 3.2 | **7.0** | +3.8 |
| Testing | 15% | 1.3 | **6.5** | +5.2 |
| CI/CD | 10% | 0.0 | **6.5** | +6.5 |
| Infrastructure & Ops | 10% | 1.5 | **4.5** | +3.0 |
| Frontend Quality | 5% | 2.5 | **3.8** | +1.3 |
| Production Readiness | 5% | 2.7 | **3.6** | +0.9 |
| Data Integrity & Isolation | — | 6.6 | **7.4** | +0.8 |
| **Weighted Total** | **100%** | **2.9** | **6.1** | **+3.2** |

---

## Verdict

| Metric | Value |
|---|---|
| **Baseline (pre-remediation)** | **2.9 / 10** (NO-GO) |
| **Current (post-remediation)** | **6.1 / 10** (GO FOR CONTROLLED PILOT) |
| **Improvement** | **+3.2 points (+110%)** |
| **Pilot-ready** | **YES** (1-2 cafés, with bounded conditions) |
| **Scale-ready (10-20 cafés)** | **NO** — needs staging load test, H-10, error tracking |

---

## Top 3 Highest-Impact Improvements

1. **Money/Financial Integrity: 3.0 → 7.4** (+4.4) — the single largest category gain. Row locks, Decimal-only ledgers, refund correctness, device auth, and idempotency mean financial operations are now defensible against concurrent and adversarial conditions.

2. **Testing: 1.3 → 6.5** (+5.2) — test count more than doubled (114 → 232), PostgreSQL coverage went from zero to full, money concurrency tests prove row-lock behavior, and N+1 query-count guards prevent future performance regressions.

3. **CI/CD: 0.0 → 6.5** (+6.5) — from nothing to a verified-green pipeline with Postgres service, migration guard, and frontend typecheck+build.

---

## Remaining Gaps (ordered by production impact)

| # | Gap | Current Score | Target | Effort |
|---|---|:---:|:---:|---|
| 1 | JWT refresh in HttpOnly cookie (H-10) | Security 6.3 | 8.0 | Medium (1-2 days) |
| 2 | Error tracking (Sentry) | Infra 4.5 | 6.0 | Small (half day) |
| 3 | Structured money-movement logging | Infra 4.5 | 6.0 | Small (half day) |
| 4 | WebSocket in Redis (channel layer) | Prod 3.6 | 5.0 | Small (deploy config) |
| 5 | ALLOWED_HOSTS + CSRF per env | Prod 3.6 | 5.0 | Small (deploy config) |
| 6 | CONN_MAX_AGE / connection pooling | Prod 3.6 | 5.0 | Small (settings) |
| 7 | Frontend E2E tests (Playwright) | Frontend 3.8 | 6.0 | Medium (1-2 days) |
| 8 | Staging environment + load test | Ops 4.5 | 7.0 | Medium (env setup) |
| 9 | Celery worker monitoring | Ops 4.5 | 6.0 | Small (health check) |
| 10 | Live S3 round-trip verification | Ops 4.5 | 6.0 | Small (bucket test) |
