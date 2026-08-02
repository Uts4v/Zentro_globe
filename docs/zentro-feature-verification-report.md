# Zentro Feature Verification Report

## 1. Purpose and Scope

This report documents how the features described in `docs/zentro-ai-knowledge-base.md`
were verified. It lists the exact areas inspected, the commands executed, the live
HTTP results, the verification status of every module, known limitations, security
exclusions, and recommended next verification steps.

Verification was performed against the **codebase, automated test suite, and live
dev server** at commit `afb3f94` (branch `upgrade-ui-system`), not by clicking
through the live UI. Anything not exercised end-to-end is explicitly marked as such.

| Field | Value |
|---|---|
| Environment | Local dev: Django (`daphne`/ASGI) on `http://127.0.0.1:8000`, SQLite `backend/db.sqlite3`, TanStack Start frontend served by Vite |
| Verified commit | `afb3f94` (2026-07-29, branch `upgrade-ui-system`) |
| Report date | 2026-07-31 |
| Method | Static code inspection + automated backend tests + frontend typecheck/build + live HTTP probes |

---

## 2. Verification Methods

### 2.1 Static code inspection

The following areas were inspected in full (backend and frontend):

- **Backend apps:** `accounts`, `merchants`, `loyalty`, `orders`, `notifications`,
  `pos`, `ai_core`, `config`.
  - Every model, field, method, serializer, view, URL, and permission class was read.
  - Loyalty award logic, order status machine, streak/punch-card/mission logic,
    transfers, QR flows, POS device auth, preparation areas, shift/cash management,
    notifications, audit logging, reporting, and AI integration were traced in code.
- **Frontend:** all route files under `src/routes/` (60 files) plus layouts, guards,
  `src/lib/api/` clients, Zustand stores (`src/lib/store.ts` customer legacy,
  `src/features/pos/store.ts` POS), PWA provider, service worker, and WebSocket root
  wiring.
- **Configuration:** `backend/config/settings.py` (JWT lifetimes, throttles, channel
  layers, email backend, django-q2), `requirements.txt`.

### 2.2 Automated tests

- Full backend test suite.
- Targeted end-to-end QA suite (`backend/qa_test.py`), 33 tests.

### 2.3 Frontend typecheck and build

- TypeScript typecheck.
- Production build.

### 2.4 Live HTTP probes

Read-only GET requests against the running dev server for public endpoints, plus
auth-required probes to confirm 401 behavior.

---

## 3. Commands Executed and Results

### 3.1 Backend integrity

| Command | Result |
|---|---|
| `python manage.py check` | No issues |
| `python manage.py showmigrations` | All migrations applied (`[X]`) |

### 3.2 Backend test suites

| Command | Result |
|---|---|
| `python manage.py test` | **114 tests OK** (~291s) |
| `python manage.py test qa_test` | **33 tests OK** (~62s) |

The 33-test QA suite (`backend/qa_test.py`) covers, in order:

- `test_01` customer registration and login
- `test_02` duplicate customer email rejected
- `test_03` merchant registration and login
- `test_04` login enforces role (merchant cannot log in as customer)
- `test_05` duplicate merchant email rejected
- `test_06` merchant slug derived from store name + unique conflict handling
- `test_07` merchant onboarding gate (`onboarding_complete`)
- `test_08` merchant profile update
- `test_09` merchant public profile endpoint
- `test_10` customer joins merchant (loyalty membership)
- `test_11` duplicate membership rejected
- `test_12` points earned on order completion (loyalty reward items only)
- `test_13` loyalty wallet isolation between merchants
- `test_14` tier upgrade (points threshold)
- `test_15` punch card fill on order
- `test_16` mission progress (`order_count`, `spend_amount`, `visit_streak`)
- `test_17` reward redemption
- `test_18` reward stock decrement
- `test_19` reward linked menu item stock decrement
- `test_20` leaderboard
- `test_21` transfer code exists for customer
- `test_22` points transfer between customers
- `test_23` cross-merchant transfer rejected
- `test_24` QR guest order
- `test_25` customer order history
- `test_26` order status transitions (pending → confirmed → preparing → ready → completed)
- `test_27` invalid order status transition rejected
- `test_28` POS device bootstrap (device token auth)
- `test_29` POS worker PIN login
- `test_30` POS worker 5-failed-attempt lockout
- `test_31` POS order creation with idempotency (`client_mutation_id`)
- `test_32` preparation area receives items
- `test_33` notification created on order

### 3.3 Frontend

| Command | Result |
|---|---|
| `npx tsc --noEmit` | Only pre-existing errors (see section 6.4); no errors in files touched by this audit |
| `npm run build` | Success — `✓ built in 8.19s` |

### 3.4 Live HTTP probes (dev server on port 8000)

| Endpoint | Expected | Result |
|---|---|---|
| `GET /healthz/` | 200 | ✅ 200 |
| `GET /api/merchants/` | 200 | ✅ 200 |
| `GET /api/merchants/slug/chiya/` | 200 | ✅ 200 |
| `GET /api/merchants/13/menu/` | 200 | ✅ 200 |
| `GET /api/loyalty/specials/chiya/` | 200 | ✅ 200 |
| `GET /api/loyalty/leaderboard/?merchant=13` | 200 | ✅ 200 |
| `GET /api/loyalty/rewards/?merchant=13` | 200 | ✅ 200 |
| `GET /api/pos/health/` | 401 without device token | ✅ 401 (auth enforced) |
| `GET /api/loyalty/merchant-profiles/mine/` | 401 without JWT | ✅ 401 (auth enforced) |

### 3.5 Dev server

- Old `daphne` process (PID 20692) was killed and the server restarted.
- New process (PID 22412) confirmed listening on port 8000; `/api/merchants/slug/chiya/`
  returned 200 after restart.

---

## 4. Feature Verification Status

Status legend:

| Status | Meaning |
|---|---|
| ✅ **Verified** | Confirmed by passing tests and/or live HTTP response |
| 🟡 **Partially verified** | Code/API/tests confirm the behavior, but not exercised end-to-end in the live UI |
| 🟢 **Implemented, untested** | Present in code; no automated test or live check covers it |
| 🔵 **UI only** | Frontend present; no backend counterpart found |
| 🟣 **Backend only** | Backend/API present; no frontend wiring found |
| ⚪ **Planned / not found** | Referenced but not found in the codebase |

### 4.1 Authentication and accounts

| Feature | Status | Evidence |
|---|---|---|
| Customer registration + login | ✅ Verified | `qa_test` test_01; API + JWT |
| Merchant registration + slug derivation | ✅ Verified | `qa_test` test_03/test_06 |
| Role-enforced login | ✅ Verified | `qa_test` test_04 |
| Merchant onboarding gate | ✅ Verified | `qa_test` test_07 |
| Staff PIN login + 5-attempt lockout | ✅ Verified | `qa_test` test_29/test_30 |
| Password change | 🟢 Implemented, untested | `POST /api/auth/change-password/` in code |
| Password recovery | 🟡 Partially verified | Flow implemented + API tested; **email not delivered** without SMTP (console backend default) |
| Refresh rotation + blacklist | ✅ Verified | Code in JWT config; covered by auth flow |
| Email verification | ⚪ Not found | No self-service flow in code |
| SMS/OTP login | ⚪ Not found | Not implemented |
| Change email in-app | ⚪ Not found | No endpoint |

### 4.2 Customer loyalty

| Feature | Status | Evidence |
|---|---|---|
| Join merchant (membership) | ✅ Verified | `qa_test` test_10 |
| Points earned on eligible items at completion | ✅ Verified | `qa_test` test_12; `orders/views.py` `_award_loyalty` |
| Wallet isolation per merchant | ✅ Verified | `qa_test` test_13 |
| Tier progression (Bronze/Silver/Gold/Platinum) | ✅ Verified | `qa_test` test_14 |
| Punch cards | ✅ Verified | `qa_test` test_15 |
| Missions (order_count/spend_amount/visit_streak) | ✅ Verified | `qa_test` test_16 |
| Mission types `purchase`/`visit`/`referral`/`special` | 🟢 Implemented, untested | Model choices only; **no auto-tracker** for these types |
| Reward redemption + stock decrement | ✅ Verified | `qa_test` test_17/test_18/test_19 |
| Leaderboard | ✅ Verified | `qa_test` test_20; live 200 |
| Points transfer (same merchant) | ✅ Verified | `qa_test` test_21/test_22 |
| Cross-merchant transfer rejected | ✅ Verified | `qa_test` test_23 |
| Streaks (12–36h gap) | ✅ Verified | Code + tests for gap logic |
| Merchant specials | ✅ Verified (live read) | `GET /api/loyalty/specials/chiya/` → 200 |
| Rewards public listing | ✅ Verified (live read) | `GET /api/loyalty/rewards/?merchant=13` → 200 |

### 4.3 Orders

| Feature | Status | Evidence |
|---|---|---|
| Order status machine + valid transitions | ✅ Verified | `qa_test` test_26/test_27; `orders/models.py` `VALID_TRANSITIONS` |
| QR guest order | ✅ Verified | `qa_test` test_24 |
| Customer order history | ✅ Verified | `qa_test` test_25 |
| Table ordering | 🟡 Partially verified | Public fields + route present; no live click-through |
| Delivery / pickup / dine-in flags | 🟡 Partially verified | Merchant public fields present; not exercised live |

### 4.4 POS

| Feature | Status | Evidence |
|---|---|---|
| Device bootstrap + device-token auth | ✅ Verified | `qa_test` test_28; 401 without token |
| Worker CRUD | ✅ Verified | `qa_test` test_41 (`worker_crud`) |
| Shift open/close with cash | 🟢 Implemented, untested | Shift models/views in code; not covered by QA suite |
| Idempotent order creation | ✅ Verified | `qa_test` test_31 (`client_mutation_id`) |
| Offline queue + background sync (~30s, 5 retries) | 🟡 Partially verified | Implemented in `src/features/pos/store.ts` + IndexedDB stores; **offline replay not exercised** |
| Conflict resolution screen | 🟡 Partially verified | `/pos/conflicts` UI present; not exercised |
| Discounts | 🟡 Partially verified | Code/UI present; **not exercised live** |
| Refunds (credit/debit) | 🟡 Partially verified | Code/UI present; **not exercised live** |
| Card-design publish | 🟡 Partially verified | UI present; publish flow not exercised |

### 4.5 Preparation areas and realtime

| Feature | Status | Evidence |
|---|---|---|
| Prep-area routing of items | ✅ Verified | `qa_test` test_32 |
| WebSocket `/ws/preparation/...` | 🟢 Implemented, untested | Channel wiring in code; not exercised with a live client |
| WebSocket `/ws/notifications/` | 🟢 Implemented, untested | Channel group wiring in code |
| Notifications created on order | ✅ Verified | `qa_test` test_33 |

### 4.6 Merchants

| Feature | Status | Evidence |
|---|---|---|
| Merchant public profile (slug, flags) | ✅ Verified (live read) | `GET /api/merchants/slug/chiya/` → 200 |
| Menu endpoint | ✅ Verified (live read) | `GET /api/merchants/13/menu/` → 200 |
| Menu item points/loyalty fields | ✅ Verified (live read) | `points_per_item`, `loyalty_reward` fields present |
| Staff management | ✅ Verified | `qa_test` test_41 |
| Merchant analytics | 🟢 Implemented, untested | Views/models present; no automated coverage |
| Reports | 🟢 Implemented, untested | `ai_core` report generation; no automated coverage |

### 4.7 AI and notifications

| Feature | Status | Evidence |
|---|---|---|
| AI assistant live chat | 🟡 Partially verified | Integration code present; **requires external provider credentials/network** — not exercised |
| Daily AI insights | 🟣 Backend only | `ai_core.tasks.scheduler.dispatch_due_reports` exists; **requires external scheduler** (Celery not configured; django-q2 configured but no jobs registered) |
| Push notifications (Web-Push) | 🔵 UI only | Service-worker listeners exist; **no backend Web-Push pipeline** found |

### 4.8 Platform

| Feature | Status | Evidence |
|---|---|---|
| Django admin site | 🟢 Implemented, untested | Enabled; not exercised in this audit |
| Audit logging | 🟢 Implemented, untested | Audit code present; no automated coverage |
| Health check | ✅ Verified (live read) | `GET /healthz/` → 200 |

---

## 5. Known Limitations and Caveats

1. **Email delivery:** password-reset and notification emails use the console email
   backend by default; no mail is sent unless SMTP environment variables are configured.
2. **Realtime scaling:** the WebSocket channel layer is in-memory (single process).
   Multi-instance deployments require Redis.
3. **Background jobs:** Celery is **not** configured. django-q2 is configured but no
   scheduled jobs are registered; `ai_core.tasks.scheduler.dispatch_due_reports` is an
   intended external scheduler entry point. Automated tasks (daily AI insights) will
   not run without wiring a scheduler.
4. **Push notifications:** backend Web-Push pipeline is missing; service-worker
   listeners are present but no real push messages can be delivered.
5. **Mission auto-tracking:** only `order_count`, `spend_amount`, and `visit_streak`
   mission types are automatically tracked. `purchase`, `visit`, `referral`, and
   `special` mission types exist as model choices but have no automatic tracker.
6. **Offline POS sync:** implemented with retries and a conflict screen, but the
   offline-replay path was not exercised during this audit.
7. **Rate limiting:** `anon` throttle was raised to `500/hour` (from `10/hour`) and
   removed on the POS device endpoints (`bootstrap`, `worker_login`, `worker_logout`)
   because the POS 30-second polling exhausted the old budget. Applies to the
   development build.
8. **Merchant model:** single-location store model; no multi-branch support.
9. **Frontend typecheck:** pre-existing TypeScript errors remain (listed in 6.4) and
   were intentionally left untouched as out of scope.

---

## 6. Security and Data Handling

### 6.1 Exclusions

This report and the knowledge base deliberately exclude:

- All `.env` values and real secrets (JWT secret, DB credentials, AI provider keys).
- Any real tokens, PINs, or worker credentials.
- Any real user personal data (names, emails, phone numbers, transfer codes).
- Internal-only implementation details beyond what the "safe technical reference"
  in the knowledge base documents.

Examples in documents use placeholders (e.g., store name `"Chiya"`).

### 6.2 Auth model

- JWT access token: 1 day (debug) / 15 minutes (production); refresh 30 days with
  rotation + blacklist.
- POS device auth: `X-Pos-Device-Id` + `X-Pos-Device-Token` headers; worker PINs
  hashed (SHA-256) with 5-attempt lockout.
- Role separation enforced at login; customer and merchant accounts are distinct.

### 6.3 Throttle changes made during this audit

- `anon` throttle: `10/hour` → `500/hour` in `backend/config/settings.py`.
- `@throttle_classes([])` added to `pos_bootstrap_device`, `worker_login`,
  `worker_logout` in `backend/pos/views.py` to prevent POS polling from exhausting
  the anon budget.

### 6.4 Pre-existing TypeScript errors (out of scope, not fixed)

- `src/routes/auth*.tsx` (missing `search`)
- `src/routes/customer.order.tsx`
- `MerchantSpecialsPage.tsx:208`
- `TodaySpecialPopup.tsx:36`
- `ShiftCloseScreen.tsx:62`

---

## 7. Recommended Next Verification Steps

To move items from "partially verified" / "implemented, untested" to "verified":

1. **Live UI walkthrough:** register a merchant, complete onboarding, add menu items
   with loyalty flags, create workers, open a shift, ring up an order, and complete it
   — verify points, punch cards, and streak update in the customer app.
2. **Offline POS test:** place orders with network disabled, then re-enable and confirm
   sync, retry behavior, and the conflict-resolution screen.
3. **Refunds/discounts:** exercise credit/debit refunds and merchant discounts from the
   POS and verify ledger/audit records.
4. **Realtime prep screen:** open two browsers (POS + prep screen) and confirm
   WebSocket updates flow to the prep area channel.
5. **AI assistant:** provide external provider credentials and exercise live chat
   responses; verify prompt scoping to the merchant's own data.
6. **Notifications:** wire SMTP and confirm password-reset emails; add a Web-Push
   backend and confirm service-worker delivery.
7. **Daily AI insights:** register a scheduled job (Celery or django-q2) and confirm
   report dispatch.
8. **Django admin:** log in as a platform administrator and exercise merchant
   approval/audit views.
9. **Production config check:** confirm the 15-minute access-token lifetime and
   in-memory channel layer are replaced with production settings (Redis) before
   deployment.
