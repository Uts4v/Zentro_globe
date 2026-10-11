# Zentro Loyalty — Production-Readiness QA Audit

**Date:** 2026-10-11
**Repo:** `C:\Users\ADMIN\Desktop\Zentro-2\Zentro_globe`
**Branch:** `upgrade-ui-system` (2 commits ahead of `origin`: `4f2e8ee`, `184cedf`)
**Method:** strict **read-only / no-changes** audit. No code, config, DB, infra, or dependency was modified. Local tests ran in an isolated temp sandbox (`%TEMP%\opencode\zentro_audit`). Production was probed with anonymous/public HTTP requests + read-only inspection only.
**Scope areas (all):** Finance/accounts, Offline POS/sync, Inventory/offers, Security/auth/RBAC, AI scanner/insights.

---

## 1. Executive summary

| Area | Verdict |
|---|---|
| Build & migrations | **PASS** — `check --deploy` clean, `makemigrations --check` no changes, TS build/typecheck green |
| Automated tests | **PASS (baseline)** — backend 832 OK (4 skipped), coverage 69%; frontend vitest green |
| Tenant isolation / IDOR | **PASS** — cross-merchant access correctly denied (local ad-hoc proof) |
| JWT rotation / logout blacklist | **PASS** — old refresh rejected after rotation |
| **Rate limiting** | **FAIL (High)** — silently inert on 17 sensitive endpoints |
| Background jobs | **FAIL (High)** — no Celery worker deployed; tasks never processed |
| Money-flow concurrency | **RISK (High/Med)** — lost-update windows in cash & wallet counters (static; live PG test not runnable locally) |
| Production delivery channels | **FAIL (Med/High)** — OTP SMS, reset email, web push, Groq AI not configured in prod |
| Security headers | **PARTIAL** — backend good but no CSP; frontend none |

**Headline:** the most serious issue is **A7 — DRF throttling is silently disabled on 17 authentication/money/OTP/PIN endpoints**, including OTP verification (intended 10/min) and POS PIN login (intended 30/min). This is proven with an A/B experiment and matches a trap the codebase already documents (but only fixed for the leaderboard).

---

## 2. Baseline (reproducible)

| Check | Command | Result |
|---|---|---|
| Django deploy check | `manage.py check --deploy` | Pass (only informational `W021`; local-dev shows `W004/W008/W009/W012/W016/W018` from `DEBUG=True`) |
| Migrations in sync | `manage.py makemigrations --check --dry-run` | "No changes detected" |
| Backend suite | `manage.py test` | **832 tests OK**, 4 skipped, **coverage 69%** |
| TypeScript | `npx tsc --noEmit` | EXIT 0 |
| Frontend unit tests | `npm test` | Pass (11 + 12, 0 fail) |
| Frontend build | `npm run build` | OK (`copy-sw: service-worker.js`; benign workbox glob warning) |
| Lint (source only) | `npx eslint src` | 21,735 problems (21,669 errors, 66 warnings) — pre-existing, dominated by `@typescript-eslint/no-explicit-any` |

**Environment note:** local runs use SQLite + `DEBUG=True`; the CI workflow (`.github/workflows/ci.yml`) uses a PostgreSQL service, so PG-only row-locking tests execute there but **skip locally**. `coverage` was installed into the backend venv as dev tooling only (no repo change).

Coverage gaps confirmed: `notifications/consumers.py` 0%, WebSocket middleware/routing 0%, `offers/tasks.py` 0%, `ai_core/use_cases/*` and `ai_core/tools/*` 0–25%; **`backend/notifications/tests.py` is a 3-line stub**.

---

## 3. Findings

Severity = impact if left as-is. Confidence = how strongly the evidence supports the finding.

### A7 — Rate limiting silently disabled on 17 endpoints — **HIGH** (confidence: HIGH)

**What.** DRF 3.18.1's `api_view` builds a fresh `WrappedAPIView` from the view function and returns `WrappedAPIView.as_view()` (`rest_framework/decorators.py:23-88`). It reads `throttle_scope` **from the inner function at decoration time** and defaults it to `None` (`decorators.py:70-71`):

```python
WrappedAPIView.throttle_scope = getattr(func, 'throttle_scope', None)
```

The repo sets the scope **after** decoration, e.g. `accounts/views.py:216`:

```python
register.throttle_scope = "login"   # lands on the as_view() closure, never read
```

So at request time `ScopedRateThrottle.allow_request` sees `getattr(view, "throttle_scope", None) is None` and returns `True` immediately (`rest_framework/throttling.py:219-225`). Because these views use `@throttle_classes([ScopedRateThrottle])`, they **also replace** the default `AnonRateThrottle`/`UserRateThrottle`, so there is **no rate limit at all** on them.

**Empirical proof (local).** Same scope `"login"`/60-per-min, 70 requests each:

| Endpoint | Style | First `429` |
|---|---|---|
| `POST /api/auth/login/` | class-based `LoginView` (`throttle_scope` class attr) | request **61** ✅ throttled |
| `POST /api/auth/register/` | function-based, post-hoc `throttle_scope` | **never** ❌ not throttled |

Instrumenting the throttle confirmed the dispatch passes `view.throttle_scope = None` for `preview_order` while `throttle_classes` is set.

**The codebase already knows.** `backend/loyalty/throttles.py` documents the exact trap and pins the scope in a custom class — but the workaround was applied **only to the leaderboard**:

> `api_view` builds a fresh `WrappedAPIView` class … and does not propagate a `throttle_scope` attribute set after decoration, so we pin the scope here instead of relying on `view.throttle_scope`.

**Affected endpoints (17):**

| Module | View | Intended scope / rate |
|---|---|---|
| accounts | `register`, `change_password`, `google_auth` | login (60/min) |
| accounts | `forgot_password`, `reset_password`, `send_otp`, `verify_otp` | **otp (10/min)** |
| accounts | `upload_image`, `upload_payment_qr` | upload (200/hr) |
| loyalty | `redeem_reward` | redeem (20/min) |
| loyalty | `transfer_create` | **transfer (20/hr)** |
| pos | `worker_login`, `pos_staff_login` | **pin (30/min)** |
| orders | `guest_create_order`, `preview_order`, `call_waiter`, (`pos` `table_order`) | guest (120/hr) |

**Impact.** OTP verification brute force / OTP-request flooding, POS PIN brute force (UIs show a *PIN_LOCKED* business lock, but that is app logic, not IP throttling), credential stuffing, transfer/redeem spam, upload abuse, guest-order spam.

**Working controls (reference).** Custom throttle classes hardcode the scope and DO work: `LeaderboardThrottle`, `MenuScanThrottle`, offers `_scoped_throttle(...)`/`OfferLookupThrottle`/`OfferClaimThrottle`/`OfferPreviewThrottle`, and the class-based `LoginView`. Prod uses `RedisCache` when `REDIS_URL` is set, so shared-worker throttling is viable — the problem is purely the wiring.

**Remediation.** For each affected function view, set the scope **before** `@api_view`, or (preferred) use the new `@throttle_scope("…")` decorator below `@api_view`, or switch to a small custom throttle class that pins `self.scope` (the existing leaderboard pattern). Add a regression test that fires `rate+1` requests at every scoped endpoint and asserts `429`.

---

### A1 — No Celery worker in production; async tasks never run — **HIGH** (confidence: HIGH)

`backend/Dockerfile.backend` starts `migrate && daphne` only; Railway has exactly two services (Frontend, Backend) and no worker. Tasks are enqueued to Redis (`ai_core.tasks.generate_merchant_report` via `.delay()` at `ai_core/tasks.py:55,59`; `offers.tasks.nightly_maintenance`) but nothing consumes them. `CELERY_TASK_ALWAYS_EAGER` is not set in prod. Result: merchant report generation and nightly maintenance silently never execute.

**Remediation.** Add a Railway worker service (`celery -A config worker`) or, if truly synchronous, set `CELERY_TASK_ALWAYS_EAGER=True`/run tasks inline explicitly. Alert on broker queue depth.

---

### A2 — Cash-shift lost update — **HIGH** (confidence: MEDIUM — static; live PG test skipped locally)

`pos/views.py::create_cash_movement` is `@transaction.atomic` but fetches `CashShift` **without** `select_for_update` (`pos/views.py:2795`) and then mutates `cash_payins`/`cash_payouts` (block `:2781-2828`). Two concurrent movements can clobber each other's totals.

**Remediation.** `CashShift.objects.select_for_update().get(...)`; add a `TransactionTestCase` concurrency test (runs in CI on Postgres).

---

### A3 — Money/wallet counter lost updates — **MEDIUM/HIGH** (confidence: MEDIUM — static)

- `credit_sale`: locks `CreditAccount` (`pos/views.py:2906`) but loads `Order` unlocked (`:2920`).
- `debit_purchase`: locks `DebitAccount` (`:3140`) but loads `Order` unlocked (`:3154`).
- `orders/views.py::update_order_status` increments `wallet.order_count` without a wallet row lock; `award_wallet_points`/`deduct_wallet_points` **reassign** `wallet = _lock_wallet(wallet)` (`loyalty/services.py:29,68`), leaving the caller's instance stale → `order_count` lost update.

**Remediation.** Lock the order rows too, and re-fetch/return the wallet after `_lock_wallet` (or centralise counter bumps inside the locked service). Cover with `TransactionTestCase` on Postgres.

---

### A8 — Production delivery channels not configured — **MEDIUM/HIGH** (confidence: HIGH)

Missing/absent prod env (confirmed via `railway variables` and the deploy setup log):

| Var | Effect if unset |
|---|---|
| `SMS_BACKEND` (defaults to console) | **OTP codes are not delivered** in prod |
| `EMAIL_BACKEND` (defaults to console) | **Password-reset emails are not delivered** |
| `VAPID_*` | Web push non-functional |
| `GROQ_API_KEY` | AI chat/insights disabled (only Gemini menu scanner works) |

**Remediation.** Configure real SMS/email transports and VAPID keys before go-live; otherwise disable the corresponding UI affordances so users are not sent down dead flows.

---

### A9 — Security headers — **MEDIUM** (confidence: HIGH)

- Backend: `Strict-Transport-Security: max-age=3600; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, COOP present — **no CSP**. HSTS `max-age` is low for a loyalty/payments app.
- Frontend (Railway static/SSR): **no** HSTS / nosniff / frame / referrer headers observed.
- `POST /api/orders/preview/` is anonymous and (per A7) unthrottled; CSP would meaningfully reduce XSS blast radius given A4.

**Remediation.** Raise HSTS to a long max-age (with preload once stable), add a Content-Security-Policy (at least `frame-ancestors`, `object-src`, `base-uri`), and apply baseline security headers to the frontend host.

---

### A4 — JWT persisted in `localStorage` — **MEDIUM** (confidence: HIGH)

Access/refresh tokens are stored under `dja`/`djr` in `localStorage`, readable by any XSS. No XSS sink was found in this audit (`dangerouslySetInnerHTML` uses were all static/hardcoded/escaped — see §4), so this is latent rather than exploited.

**Remediation.** Prefer httpOnly, `Secure`, `SameSite` cookies with CSRF protection, or short-lived access tokens + silent refresh.

---

### A6 — Raw `fetch` in inventory API layer — **LOW** (confidence: HIGH)

`src/lib/api/inventory.ts` bypasses the shared API client, so it may miss auth header injection, 401-refresh, and unified error handling used elsewhere.

**Remediation.** Route through the shared client.

---

### A10 — Accessibility & minor web hygiene — **LOW** (confidence: MEDIUM — heuristic)

- Many icon-only `<button>` elements lack an accessible name (`aria-label`); heuristic scan (not rendered-tested) flags `src/features/pos/screens/CartPanel.tsx` (12), `OrderDetailScreen.tsx` (11), `OptionGroupsEditor.tsx` (8), `PosLayout.tsx` (7), and others.
- `<img>` `alt` coverage is effectively complete (all real JSX images have `alt`; the 3 scanner hits were non-JSX utility strings).
- `target="_blank"` links all include `rel="noreferrer"`.
- `robots.txt` returns 404 on the frontend.

**Remediation.** Add `aria-label` to icon-only controls; add a `robots.txt`.

---

### A5 — Media persistence — **MITIGATED** (no action)

Prod mounts `RAILWAY_VOLUME_MOUNT_PATH=//app/media`, so uploads persist on the Railway volume (not S3). Durable enough for current scale; `USE_S3_STORAGE` is unset. Single-volume, so multi-instance scaling later requires S3.

---

## 4. Verified-good / non-issues (checked, no finding)

- **Tenant isolation / IDOR:** cross-merchant access to finance entries, inventory items, and offer campaigns returns `404`/correctly-scoped lists (local ad-hoc proof). No leakage.
- **JWT rotation & logout blacklist:** rotation issues new refresh and rejects the previous one.
- **XSS sinks:** all `dangerouslySetInnerHTML` uses are safe — `__root.tsx` injects a static theme/splash script + static CSS; `LoyaltyCard`/`HeroLoyaltyCard` use `getIllustrationSVG`, a closed switch over typed presets; `KOTTicket`'s `kotMarkup` escapes **every** interpolated field via `escapeHtml`.
- **Notifications API:** basic create/read/list works (model fields: `title`, `message`, `notification_type`, `is_read`).
- **Prod HTTP surface (anonymous):** `/healthz/` 200; CORS preflight limited to the frontend origin with credentials; `/api/auth/me/` 401; bad table token 404; `/media/..%2f..%2fbackend/.env` 404.

---

## 5. NOT TESTED (with reason)

| Item | Reason |
|---|---|
| Production `EXPLAIN ANALYZE` / query plans | Prod Postgres is on `postgres.railway.internal` with no public TCP proxy; `railway run` does not rewrite the internal host → connection fails. Read-only SQL could not be executed. |
| Money-flow concurrency under real PG locking (A2/A3 live repro) | Local DB is SQLite; no Docker/local Postgres. Covered only by static review here; CI Postgres exercises these. |
| Any authenticated or state-changing prod test | Out of the approved no-changes scope. |
| Load / stress / soak testing | Out of scope. |
| Full offline POS sync under network loss | Partial only (build + service worker presence verified); no disconnect/reconnect soak. |
| AI insights/chat runtime behavior | `GROQ_API_KEY` unset (`ai_core` logs "Groq provider disabled"). |

---

## 6. Prioritized remediation

1. **A7 (High):** fix `throttle_scope` wiring on all 17 views + regression test. Immediate security win.
2. **A1 (High):** deploy a Celery worker (or make tasks eager) and monitor the queue.
3. **A8 (High):** configure SMS/email/VAPID/Groq in prod, or hide the dead flows.
4. **A2/A3 (Med/High):** add row locks for cash-shift, orders, and wallet counters; add PG concurrency tests.
5. **A9/A4 (Med):** CSP + long HSTS; apply baseline headers to the frontend; consider cookie-based tokens.
6. **A6/A10 (Low):** unify the inventory API client; add `aria-label`s and `robots.txt`.

## 7. Appendix — artifacts & repro

- Temp audit harness (no repo changes): `%TEMP%\opencode\zentro_audit\` — `auditapp/tests2.py` (JWT rotation/blacklist, cross-tenant IDOR, notifications; 7 tests, all pass), `auditapp/tests.py` (cash-shift concurrency; PG-only, skips on SQLite), `audit_settings.py`, `prod_db_probe.py`, `scan_frontend.py`.
- Run pattern: `PYTHONPATH=<tempdir> DJANGO_SETTINGS_MODULE=audit_settings .venv\Scripts\python.exe manage.py test auditapp`.
- Throttle A/B repro: 70× `POST /api/auth/login/` (429 at #61) vs 70× `POST /api/auth/register/` (never 429), cache cleared between runs.
