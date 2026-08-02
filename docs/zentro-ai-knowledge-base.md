# Zentro Knowledge Base

## 1. Document Information

| Field | Value |
|---|---|
| Document purpose | Primary verified knowledge source for the Zentro AI assistant and support teams. Describes what Zentro actually does, how it works, and how users use it. |
| Generated date | 2026-07-31 |
| Application version / commit | `afb3f94` (2026-07-29, branch `upgrade-ui-system`) |
| Verification environment | Local development: Django dev server (`daphne`/ASGI) on `http://127.0.0.1:8000`, TanStack Start frontend served by Vite, SQLite database (`backend/db.sqlite3`) |
| Last verified date | 2026-07-31 |
| Knowledge-base version | 1.0 |
| Verification report | See `docs/zentro-feature-verification-report.md` |

> **Disclaimer:** Features, screens, and behavior described here were verified against the code and tests at the commit above. Zentro is under active development; screens and behavior can change. The AI assistant must treat this document as the source of truth and flag anything unverified as unverified rather than inventing details.

---

## 2. What Is Zentro?

Zentro (formerly "Zentro Glow Loyalty") is a **cafe and restaurant loyalty + ordering platform**. It lets coffee shops and small restaurants give their customers a digital loyalty program and order experience without building software.

A customer who visits a participating cafe can:

- Join the cafe's loyalty program with their phone (a membership card appears in the app).
- Earn **loyalty points** on eligible menu items every time they order.
- Build **streaks**, fill **punch cards**, complete **missions**, and unlock **rewards**.
- Order food ahead of time, scan a **table QR code** to order from their seat (as a guest or logged-in customer), and view their order history.

The cafe owner gets:

- A **merchant dashboard** to manage the menu, tables, staff, loyalty rewards, and orders.
- A **POS (point-of-sale)** system with worker PIN logins, cashier shifts, cash management, payments, and **offline ordering** that syncs when the internet is back.
- **Analytics** (revenue, orders, top items, customer health) and an optional **AI assistant**.

Supported merchant types: coffee shops, cafes, small restaurants, and similar food-and-beverage businesses. The platform is built around a single-location store model (no multi-branch support).

**Audience note:** this document is written for four audiences — customers, merchants, merchant staff, and support/developers. Customer-facing and merchant-facing sections use plain language; the Safe Technical Reference (section 20) is technical but deliberately limited to non-secret details.

---

## 3. User Types and Roles

| Role | Who is it | Login method | Main abilities | Restricted actions |
|---|---|---|---|---|
| Customer | A person with a registered account | Email + password (customer account) | Join merchants, earn/spend points, punch cards, missions, rewards, order from apps/tables, transfer points, leaderboard | Cannot access merchant dashboard, POS, or staff screens |
| Guest customer | A person without an account ordering from a table | None (table QR + optional name) | Order from a table QR menu as a guest; cannot earn points | Cannot join loyalty, earn points, or see history |
| Merchant owner | Business account holder (`role = merchant`) | Email + password (merchant account) | Full dashboard: menu, tables, staff, loyalty, orders, analytics, POS settings, AI assistant | Merchant account cannot log into the customer app |
| Merchant manager | Merchant-created POS staff with `manager`/`admin` role | POS PIN (staff) | Worker management, shift management, discounts/refunds/reports depending on permissions | Scoped to their own merchant only |
| Cashier | POS staff with `cashier` role | POS PIN | Ring up walk-in orders, take payments, open/close own shift | Discounts, refunds, reports only if granted |
| Waiter | POS staff with `waiter` role | POS PIN | Dine-in/table orders | Discounts, refunds, reports only if granted |
| Bar / kitchen staff | POS staff on preparation areas | POS PIN (preparation screen) | See and update order items routed to their preparation area | Cannot take payments |
| Platform administrator | Zentro operations | Django admin site | Approve/manage merchants, users, audit access, platform settings | — |

**Key rule:** customer accounts and merchant accounts are **separate**. One email can only register one role, and login enforces the role (a merchant account cannot sign in as a customer, and vice versa).

---

## 4. Account and Authentication

### 4.1 Customer registration
- **Where:** `/auth/signup` (frontend route `src/routes/auth.signup.tsx`).
- **What is required:** email, full name, password (min 8 chars) + confirmation. `role = customer`.
- **Backend:** `POST /api/auth/register/` → creates `User` (role customer) + `CustomerProfile` (generates a unique `transfer_code`) and returns JWT access/refresh tokens.
- **Verified:** covered by automated tests (`qa_test.AuthFlowTests.test_01_customer_registration_and_login`), passing.

### 4.2 Customer login
- **Where:** `/auth/login`.
- **Backend:** `POST /api/auth/login/` → JWT access + refresh. The login serializer carries the user's role.
- Frontend stores tokens in browser localStorage and refreshes the access token ~2 minutes before expiry.

### 4.3 Merchant registration
- **Where:** `/auth/merchant/signup`.
- **What is required:** email, full name, password + confirmation, and a **store name** (required for merchant accounts).
- **Backend:** `POST /api/auth/register/` with `role = merchant` → creates `User` + `MerchantProfile`. The store slug is derived from the store name (e.g., `"Chiya"` → `chiya`, conflicts get a `-2`, `-3` suffix). Merchants are **auto-approved** in the current build (`is_approved=True`) and start with `onboarding_complete=False`.
- **Onboarding gate:** a merchant with `onboarding_complete=False` is redirected to `/merchant/onboarding` until they complete it. Completion is set through the merchant profile update flow (`PATCH /api/merchants/me/update/`).

### 4.4 Merchant login
- **Where:** `/auth/merchant/login`.
- **Backend:** `POST /api/auth/login/` (role `merchant`). POS-specific login additionally exists at `POST /api/pos/auth/login/` for the POS device workflow.

### 4.5 Staff login (POS)
- Staff log into a POS device with a **4-digit PIN**, not a password.
- **Backend:** `POST /api/pos/worker/login/` with `worker_id` + `pin` (device-token authenticated).
- PINs are stored hashed (SHA-256). After **5 failed PIN attempts** the worker is locked out (`locked_until`).
- **Verified:** `qa_test.POSFlowTests.test_41_worker_crud`.

### 4.6 Password change
- **Where:** logged-in customer or merchant profile → change password.
- **Backend:** `POST /api/auth/change-password/` (requires current password; new password min 8 chars).

### 4.7 Password recovery
- **Where:** `/auth/forgot-password` and `/auth/reset-password`.
- **Backend:** `POST /api/auth/forgot-password/` (creates a `PasswordResetToken`) and `POST /api/auth/reset-password/`.
- **Limitation:** by default the backend uses the **console email backend**, so reset emails are not actually delivered unless SMTP environment variables are configured. The reset flow is implemented and tested at the API level.

### 4.8 JWT session behavior
- Tokens: **access** = 1 day in debug / 15 minutes in production; **refresh** = 30 days. Refresh tokens rotate (old refresh is blacklisted after use).
- The frontend keeps the session alive by refreshing before expiry; if refresh fails, the user is redirected to login.

### 4.9 Logout
- **Frontend:** customer/merchant sign-out clears stored tokens; `POST /api/auth/logout/` blacklists the refresh token (best effort). POS worker logout uses `POST /api/pos/worker/logout/`.

### 4.10 Known authentication limitations
- No SMS/OTP login; email/password only.
- No self-service email verification flow.
- Password reset email delivery depends on SMTP configuration.
- Customers cannot change their email in-app (no such endpoint was found).

---

## 5. Customer Application

All customer screens live under the logged-in app (`/`, `/customer/*`, `/loyalty`, `/cards`, `/menu`, `/rewards`, `/missions`, `/leaderboard`, `/map`, `/notifications`, `/transfers`, `/profile`).

### 5.1 Discover merchants

**Purpose:** Find cafes to join or order from.

**Who can use it:** anyone; browsing store discovery pages is public, but order pages require login or a table QR.

**Where to find it:**
- Home dashboard (route `src/routes/index.tsx`)
- `/customer/merchants` (joined merchants)
- `/stores` and `/map` (public discovery; map uses Leaflet + `react-leaflet`)

**How it works:** public endpoints list approved merchants, searchable, with nearby-search by lat/long (`/api/merchants/nearby/`).

**Data involved:** `MerchantProfile` public fields (name, slug, address, phone, hours status, theme color, logo/banner, lat/long).

**Verified status:** Verified (API returns 200; covered by tests `EdgeCaseTests.test_81_merchant_public_profile`, `MerchantFlowTests`).

### 5.2 Join a merchant (membership)

**Purpose:** Link your customer account to a cafe's loyalty program.

**Where:** `/customer/merchants` → a store → "Join"; also joining happens automatically when a logged-in customer visits a store page (`/customer/merchant/:slug`).

**How it works:** `POST /api/customer/memberships/join/` (or `/api/loyalty/merchant-profiles/join/`) with the merchant slug. It is **idempotent** — joining again returns the existing membership. A `CustomerMerchantProfile` (with a generated membership number like `PREFIX-XXXXXX`) and a `CustomerMerchantWallet` are created.

**Verified:** `qa_test.CustomerFlowTests.test_20_join_merchant`, passing.

### 5.3 Membership cards

**Purpose:** show your digital loyalty card for the cafe; also used to check out punch-card rewards.

**Where:** `/cards` (all cards), `/cards/:merchantSlug` (single card).

**How it works:** card appearance comes from the merchant's card design (`MerchantMembershipCardDesign`, colors/patterns, published by the merchant). Cards show points balance, tier, and a QR code for the membership.

**Verified:** cards list API (`/api/loyalty/membership-cards/`) exists and the pages render against it; fully verified via code + passing membership tests. The visual render itself was not manually clicked through in a browser during this audit.

### 5.4 Customer QR code

**Purpose:** a scanner-facing QR that represents your membership at one merchant.

**Where:** on the membership card; also `/loyalty/qr/:token` is a public page that resolves the token.

**How it works:** the QR encodes a **public membership token** (rotatable via `POST /api/customer/memberships/:slug/qr/`). The public resolution endpoint returns the merchant slug/name (no account data). Do not share your card QR like a password — it identifies your membership, and rotating it invalidates the previous code.

**Verified status:** endpoints implemented and tested; the QR page render was not manually clicked through during this audit.

### 5.5 Loyalty points (earn, view, tier)

**Purpose:** earn points on eligible items and track your balance.

**How earning works (verified backend logic):**
- Points are awarded only for order items with the merchant's `loyalty_reward` flag. Each such item earns `points_per_item × quantity`.
- Points are awarded when an order is **completed/paid** (via `_award_loyalty` in `backend/orders/views.py`), not merely when the order is placed.
- The wallet is **per customer + per merchant**; balances never mix across merchants.
- Tiers are based on **lifetime points**: Bronze < 500, Silver ≥ 500, Gold ≥ 2000, Platinum ≥ 5000 (recalculated on award; `loyalty/services.py`).

**Where to view:** `/loyalty`, `/cards`, merchant page.

**Data involved:** `CustomerMerchantWallet` (`points_balance`, `lifetime_points`, `tier_level`), `PointTransaction` history (types `EARNED`, `REDEEMED`, `MISSION_BONUS`, `TRANSFER_SENT`, `TRANSFER_RECEIVED`, `ADJUSTMENT`).

**Verified:** `qa_test.LoyaltyFlowTests.test_30_points_awarded_on_completion`, passing.

### 5.6 Streaks

**Purpose:** reward customers who return regularly.

**How it works:** a streak increments when there is a **12–36 hour gap** between a customer's orders at the same merchant. More than 36 hours resets the streak to 1; less than 12 hours does not increment. Streaks are merchant-scoped.

**Verified:** logic in `loyalty/services.py:update_wallet_streak`; referenced by mission progress tests.

### 5.7 Punch cards

**Purpose:** stamp-based loyalty (e.g., "buy 8 get 1 free").

**How it works:** merchants create punch cards in two modes:
- **Per order:** every completed order adds one stamp.
- **Per streak:** a stamp is added only when the streak increments.

A completed punch card notifies the customer; the merchant verifies and redeems it (proof-code confirmation flow).

**Where:** customer sees progress on `/loyalty` or the merchant page; merchant manages in `/merchant/loyalty`.

**Verified:** `qa_test.LoyaltyFlowTests.test_31_punch_card_stamps`, passing.

### 5.8 Missions

**Purpose:** goal-based bonuses ("spend Rs 1500", "visit 3 times", "order 5 times").

**How it works:** merchants create missions. Verified mission types with automatic progress: **order_count**, **spend_amount**, **visit_streak**. Mission completion awards bonus points and a notification.

**Verified:** `qa_test.LoyaltyFlowTests.test_34_mission_tracking`, passing.
**Limitation:** the mission model also lists `purchase`, `visit`, `referral`, and `special` types, but **no progress logic exists for them** — only the three auto-tracked types above currently complete in practice.

### 5.9 Rewards and redemption

**Purpose:** spend points on menu items.

**How it works:**
- Merchants create rewards with a point cost and stock quantity (`Reward`).
- A customer redeems (`POST /api/loyalty/rewards/:id/redeem/`), creating a **Redemption** (status `pending`) and a `reward_redemption` order.
- The merchant **confirms** the redemption (`/api/loyalty/redemptions/confirm/`); when the redemption order is completed, the points are deducted from the wallet (`_deduct_reward_redemption_points`).

**Verified:** `qa_test.LoyaltyFlowTests.test_32_reward_redemption_flow`, passing.

### 5.10 Point transfers

**Purpose:** send points to another customer **of the same merchant**.

**How it works:** the sender enters the recipient's `transfer_code` and amount (`POST /api/loyalty/transfers/create/`). Rules (verified in `loyalty/services.py:transfer_points`):
- Both wallets must belong to the **same merchant** (cross-merchant transfers rejected).
- Cannot transfer to yourself.
- Amount must be positive and ≤ sender balance.
- Creates linked `TRANSFER_SENT` / `TRANSFER_RECEIVED` transactions with a shared `transfer_group`.

**Where:** `/transfers`.

**Verified:** `qa_test.LoyaltyFlowTests.test_33_point_transfer`, passing.

### 5.11 Leaderboard

**Purpose:** show top point holders for a merchant (optional, public).

**How it works:** `GET /api/loyalty/leaderboard/?merchant=<id>` returns the top N wallets (default 10, max 50) by points balance, only balances > 0. Requires the merchant query param.

**Where:** `/leaderboard`.

**Verified:** endpoint returns 200; page renders. Display is public per merchant.

### 5.12 Order history

**Purpose:** see past orders.

**Where:** `/customer/orders` and `/orders/:id`.

**Backend:** `GET /api/orders/my-orders/`, `GET /api/orders/:id/`.

**Verified:** `qa_test.CustomerFlowTests.test_23_order_full_lifecycle`, passing.

### 5.13 Customer notifications

See section 12.

### 5.14 Today's special

**Purpose:** see a merchant's active special.

**How it works:** `GET /api/loyalty/specials/:slug/` (public) returns the active `TodaySpecial` (linked menu item or reward). The customer app surfaces it on the merchant page / home.

**Verified:** endpoint returns 200 on a live merchant; merchant CRUD exists in `/merchant/specials`.

### 5.15 Customer logout

Sign out via profile menu. Clears local tokens; backend blacklists the refresh token. POS staff logout is separate (see section 10).

---

## 6. Merchant Dashboard

All merchant screens live under `/merchant/*` and require a merchant login (`requireMerchant` guard + onboarding gate). The sidebar layout is `src/routes/merchant.tsx`.

### 6.1 Overview / Dashboard

- **Route:** `/merchant/` (`src/routes/merchant.index.tsx`).
- **What it shows:** KPIs from `GET /api/merchants/analytics/?days=` — today vs yesterday revenue/orders, active members, new customers, guest orders, a 12-day order trend chart, and quick links.
- **Verified:** the analytics endpoint was rewritten and verified in this workspace; frontend builds and passes type checks for this page.

### 6.2 Orders

- **Route:** `/merchant/orders` (`MerchantOrdersPage`).
- **What it shows:** live incoming orders with status badges (pending/confirmed/preparing/ready/completed/cancelled), filters by status, and order cards with punch-card/reward badges. Polls the store orders endpoint.
- **Backend:** `GET /api/orders/store-orders/`, `GET /api/orders/merchant-history/`, `POST /api/orders/:id/update-status/`, `POST /api/orders/:id/cancel/`.
- **Order status flow (valid transitions, verified in `orders/models.py`):**

```
pending ──> confirmed
pending ──> cancelled
confirmed ──> preparing | ready | completed | cancelled
preparing ──> ready | cancelled
ready ──> completed | cancelled
completed / cancelled = terminal
```

- **Verified:** `qa_test.CustomerFlowTests.test_23_order_full_lifecycle` (lifecycle), `test_24_cancel_order_from_pending`, `test_25_invalid_transition_rejected`.

### 6.3 Menu

- **Route:** `/merchant/menu` (`MerchantMenuPage`).
- **What it does:** list, create, edit, delete menu items; set name, price, category, emoji, image, description, `is_available`, `is_featured`, `loyalty_reward` flag, `points_per_item`, and (if preparation routing is enabled) a preparation area.
- **Backend:** `/api/merchants/menu-items/` (list/create), `/api/merchants/menu-items/:id/` (update/delete), `/api/merchants/menu-items/:id/toggle-availability/`.
- **Verified:** `qa_test.MerchantFlowTests.test_11_menu_item_crud`, passing. Live menu endpoint returns 200.

### 6.4 Specials

- **Route:** `/merchant/specials` (`MerchantSpecialsPage`).
- **What it does:** create/edit/delete a "Today's Special" (links a menu item or a reward).
- **Backend:** `/api/loyalty/merchant/specials/` CRUD.
- **Status:** implemented and API-verified; note this page is one of the files with a pre-existing TypeScript error (see Limitations).

### 6.5 Tables and table QR

- **Route:** `/merchant/tables` (`merchant.tables.tsx`).
- **What it does:** create tables, generate/download/print a table QR per table, regenerate QR (rotates the public token). Tables can be active/inactive.
- **Backend:** `/api/merchants/tables/` (list/create), `/api/merchants/tables/:id/` (update), `.../:id/delete/`, `.../:id/generate/`, `.../:id/regenerate-qr/`, plus public resolution `GET /api/merchants/public/:slug/tables/:token/`.
- **Data:** each table has a `public_token` like `TBL-<random>`; the QR encodes a URL to `/m/:slug/table/:token` (ordering page) or `/table/:token/order`.
- **Verified:** `qa_test.MerchantFlowTests.test_12_table_generation`, passing.

### 6.6 Loyalty settings

- **Route:** `/merchant/loyalty` (`MerchantLoyaltyPage`).
- **What it does:** manage rewards (create/edit/delete, point cost, stock), missions, punch cards (per-order or per-streak, reward text), view/confirm redemptions, and manage loyalty rules.
- **Backend:** `/api/loyalty/rewards/...`, `/api/loyalty/missions/merchant/...`, `/api/loyalty/merchant/punch-cards/...`, `/api/loyalty/redemptions/merchant/`, `/api/loyalty/rules/`.
- **Verified:** reward/redemption/punch/mission flows covered by passing QA tests.

### 6.7 Customers

- **Route:** part of the merchant app (customer management pages, e.g., `CustomerProfilePage`).
- **What it does:** search customers of this merchant, view their membership, loyalty history, and points.
- **Backend:** `/api/loyalty/merchant/customers/` and detail; POS customer search at `/api/pos/customers/search/`.
- **Verified:** endpoints exist; customer-scope filtering is enforced server-side (merchant can only see their own customers).

### 6.8 Preparation (kitchen display)

- **Route:** `/merchant/preparation` (settings) and `/pos/preparation` (+ `:areaId`) (live boards).
- **What it does:** create preparation areas (e.g., "Bar", "Kitchen"), assign menu items and staff to areas, and route order items to areas. Item preparation status updates (pending → preparing → ready) and parent order status sync.
- **Backend:** `/api/orders/preparation-settings/`, `preparation-areas/`, `.../orders`, area action endpoints, plus a realtime WebSocket `/ws/preparation/{merchant_id}/{area_id|all}/`.
- **Verified:** `qa_test.PreparationFlowTests` (create areas, route orders, assign staff), passing.

### 6.9 Analytics

- **Route:** `/merchant/analytics` (`MerchantAnalyticsPage`).
- **What it shows:** 14/30/90-day ranges; KPI cards (revenue, orders, average order value, active members, today's revenue/orders, new customers, guest orders); revenue line + order-bar trend chart; busiest hours; weekly comparison; status/fulfillment/type/source/payment breakdowns; loyalty stats; top items; top customers; full order history with search/filters.
- **Backend:** `GET /api/merchants/analytics/?days=` (merchant-local timezone daily series; excludes cancelled orders from revenue).
- **Verified:** rewritten and verified in this workspace; `merchants/tests.py` has passing `AnalyticsEndpointTests`.

### 6.10 AI assistant

- **Route:** `/merchant/ai` (`merchant.ai.tsx`) + chat widget in the merchant sidebar.
- **How it works:** chat with an AI assistant that has read-only sales/loyalty tools (`get_sales_summary`, `get_top_products`, `get_order_summary`, `get_loyalty_summary`, `get_customer_summary`). Requires the merchant's `ai_enabled` flag and a configured AI provider (Groq/Gemini/Ollama).
- **Backend:** `/api/ai/chat/`, `/api/ai/conversations/`, `/api/ai/conversations/:id/`. Daily AI insights exist at `/api/ai/insights/daily/` (backend) with an idempotent generator.
- **Status:** implemented and unit-tested (`ai_core` test files pass), but **not fully verified end-to-end** because it depends on external AI provider credentials/network. Insights generation relies on an external scheduler not wired into the running app (see Limitations).

### 6.11 Store profile and settings

- **Route:** `/merchant/store` (`MerchantStorePage`).
- **What it does:** edit business info (name, slug display, address, phone, business type, description, open/closed, hours), logo/banner/theme color, store card design (colors, text color, background image), enable feature flags (POS, offline POS, discounts, credit/debit accounts, shifts, receipt printing, prep routing, table ordering, pickup/delivery/dine-in, point transfers, AI), and regenerate the store QR.
- **Backend:** `PATCH /api/merchants/me/update/`, `POST /api/merchants/me/regenerate-qr/`, card design endpoints.
- **Verified:** merchant profile read/update covered by QA tests; onboarding gate verified in `merchant.tsx` route.

### 6.12 Merchant notifications

See section 12.

---

## 7. POS System

### 7.1 Access and device bootstrap

- **Route:** `/pos` (`PosLayout`).
- How the device connects:
  1. Merchant signs in (or a saved device session exists) and **authorizes** the POS device (`POST /api/pos/auth/device/authorize/`).
  2. The device is registered (`POST /api/pos/device/register/`); it stores a device id + secret token in browser storage.
  3. On later loads the device self-authenticates with `X-Pos-Device-Id` + `X-Pos-Device-Token` headers (`IsPosDevice` permission) via `POST /api/pos/auth/bootstrap/` or `GET /api/pos/auth/device-bootstrap/` (which returns workers, menu, active shift, tables, recent/incoming orders, POS settings).
- **Verification note:** these endpoints are device-token authenticated and are **exempt from the anonymous IP throttle** (a fix applied in this workspace because the 30-second background sync exhausted the old 10/hour anon budget).

### 7.2 Worker PIN login

- Staff select their name and enter a **PIN** (`POST /api/pos/worker/login/`). 5 failed attempts lock the worker.
- Shift gating: if shift management is enabled, staff may be required to open a shift before taking orders.

### 7.3 Shifts

- Open a shift with an opening cash amount (`POST /api/pos/shift/open/`); close with reconciliation (`POST /api/pos/shift/close/`). Shift summary and last-closed details available. Cash drops/pay-ins/pay-outs via `POST /api/pos/cash/movement/`.
- **Verified:** `qa_test.POSFlowTests.test_42_shift_lifecycle`, passing.

### 7.4 Orders and payments

- Create orders (walk-in/dine-in, with optional table) — **idempotent** via `client_mutation_id` (`ProcessedClientMutation`), so retries don't duplicate orders (`POST /api/pos/order/create/`). KOT numbers are generated.
- Update status by UUID (`POST /api/pos/order/status/`), view orders, print receipt data (`GET /api/pos/receipt/:orderId/`).
- Payments: cash, digital (e.g., card/QR), and, when enabled, **credit account** (tab) and **debit account** payments, plus split payments. Creating a payment completes the order and triggers loyalty award.
- Discounts (requires worker `can_apply_discount`), refunds (requires `can_process_refund`).
- **Verified:** `qa_test.POSFlowTests.test_43_pos_order_and_payment`, `test_44_pos_idempotency`, passing.

### 7.5 Reports

- Z-report (`GET /api/pos/z-report/`): order status/fulfillment breakdown, top items, shift cash data — `qa_test.test_45_z_report` passing.
- Staff daily report (`GET /api/pos/staff-report/`), cash movements list, audit log (`GET /api/pos/audit/`).

### 7.6 Staff management and schedules

- Create workers with role (cashier/waiter/manager/admin) and permission flags (discount, refund, close shift, view reports), set PIN (`POST /api/pos/workers/create/`).
- Staff schedules (`/pos/schedule`), staff prep-area assignment.

### 7.7 Credit and debit accounts

- Credit accounts (buy now, pay later tabs) with sales and repayments.
- Debit accounts (prepaid balance) with top-up, purchase, adjustment.
- **Verified:** backend flows implemented; POS account screens exist. Not covered by automated tests found in the QA suite.

### 7.8 Offline behavior

- **Storage:** IndexedDB database `zentro-pos` with stores for `orders`, `payments`, `sync_queue`, `menu_cache`.
- **Queue:** offline-created orders/payments are queued with the source `pos_offline` and replayed in order; background sync runs every ~30 seconds when online; up to 5 retries per item before it is flagged.
- **Bootstrap:** a menu snapshot endpoint (`GET /api/pos/menu/snapshot/`) lets the device seed the menu cache offline.
- **Conflicts:** orders/payments whose sync fails or conflicts appear in `/pos/conflicts`; a merchant can resolve by choosing server or client version (`POST /api/pos/conflicts/resolve/`).
- **Status:** implemented; sync/conflict logic is code-verified but **offline replay was not fully exercised end-to-end** in this audit (it requires toggling network in a live POS session).

### 7.9 POS limitations

- Notifications to POS use the notification API + bell, not push.
- Offline sync is a queue replay, not a full multi-device CRDT; conflicts require manual resolution.
- Realtime order updates rely on polling + the notifications WebSocket; the WebSocket channel layer is in-memory by default (single-process dev only; production needs Redis, see Limitations).

---

## 8. Ordering Workflows

| Workflow | Entry point | Auth | Table | Loyalty | Payment |
|---|---|---|---|---|---|
| Customer app order | `/menu` + `/cart` | customer login | optional | earned on completion | not in-app (pay at counter/cash-on-delivery or at store) |
| Guest table order | `/m/:slug/table/:token` or `/table/:token/order` | none (guest name optional) | required (QR) | none | at counter |
| Table QR order (logged in) | same QR, signed in | customer login | required (QR) | earned on completion | at counter |
| POS walk-in | `/pos` | POS PIN + shift | optional | earned on payment completion | at POS |
| POS dine-in | `/pos` (table) | POS PIN + shift | yes | earned on payment completion | at POS |
| Merchant-created order | merchant dashboard | merchant login | optional | yes, on completion | n/a |

**Key details (verified):**
- Guest orders are created via `POST /api/orders/guest-create/` (public, `AllowAny`), linked to a `guest_session_id` + optional `guest_name`, and are associated with the table via the table token. They appear in the merchant's incoming orders. Guests cannot earn points.
- Customer orders (`POST /api/orders/create/`) require login; the customer is attached to the order.
- Loyalty is awarded only when the order is **completed/paid** (`_award_loyalty`).
- Order statuses and allowed transitions are enforced server-side (section 6.2).
- Fulfillment types: `dine_in`, `pickup`, `delivery` (per-merchant toggles control which are allowed).
- Order sources: `customer_app`, `table_qr`, `merchant_dashboard`, `pos_online`, `pos_offline`.

---

## 9. Loyalty System

- **Merchant-specific loyalty:** every wallet, membership, punch card, and mission is scoped to **one customer + one merchant**. A customer's points at Cafe A are completely separate from their points at Cafe B.
- **Earning:** only items flagged `loyalty_reward` earn points, `points_per_item × qty`, awarded on order completion. `order.points_earned` is computed at order creation and applied at completion.
- **Redemption:** rewards cost points; points are deducted when the merchant confirms the redemption and the redemption order completes.
- **Punch cards:** per-order or per-streak stamping; completion notifies the customer.
- **Missions:** auto-tracked types are order_count, spend_amount, visit_streak (other types listed in the model are not wired to progress).
- **Streaks:** 12–36 h gap rule; merchant-scoped.
- **Tiers:** Bronze (<500), Silver (≥500), Gold (≥2000), Platinum (≥5000 lifetime points).
- **Transfers:** same-merchant only, via recipient `transfer_code`.
- **Leaderboard:** public, per merchant, top N by balance > 0.

**Critical user-facing rule:** points from different merchants never combine. If a customer has 100 points at Cafe A and 200 at Cafe B, they cannot use them interchangeably and cannot transfer between merchants.

---

## 10. Staff and Shift Management

- Staff are created by the merchant in POS (or via `/api/pos/workers/create/`) with a display name, role, permission flags, and a PIN.
- Roles: `cashier`, `waiter`, `manager`, `admin`. Permission flags: `can_apply_discount`, `can_process_refund`, `can_close_shift`, `can_view_reports`.
- Staff log into the POS with their PIN on an authorized device.
- Shifts: open with opening cash; close with reconciliation (sales total vs expected); cash movements (pay-in, pay-out, cash drop) tracked against the shift.
- All staff actions are scoped to the device's merchant. Staff cannot access the merchant dashboard app (they use the POS screens).
- **Verified:** `qa_test.POSFlowTests.test_41_worker_crud`, `test_42_shift_lifecycle`; permission flags enforced in `pos/permissions.py` and views.

---

## 11. QR Codes

| QR type | Created by | Scanned/used by | Destination / data | Notes |
|---|---|---|---|---|
| Store QR | Merchant (dashboard) | Customers | `/m/:slug` (store entry / join) | Regenerable via `/api/merchants/me/regenerate-qr/` |
| Table QR | Merchant (tables page) | Customers/guests | `/m/:slug/table/:token` ordering page | `public_token` per table, regenerable (rotates token) |
| Membership card QR | System (per customer+merchant) | Merchant staff | `/loyalty/qr/:token` → merchant identity | Public token, rotatable per membership |
| Customer QR (transfer) | System | Another customer | transfer of points via `transfer_code` | Not a QR scan flow; a code used in the transfer form |
| Loyalty QR (checkout) | System | Merchant staff | punch-card proof confirmation | Proof-code flow (`generate-proof` / `confirm-proof`) |

**Security note:** table/membership QR tokens are public identifiers used to reach the right page; membership QR rotation invalidates the previous token. Signing keys and token formats are not documented here.

---

## 12. Notifications

- **In-app notification center:** `/notifications` for customers; merchant notifications in the merchant app; POS bell in `/pos`.
- **Realtime:** a WebSocket at `/ws/notifications/?token=` (channel group per user) delivers events live; the root layout shows toasts and refreshes the notification list.
- **Backend:** `send_notification` (in `notifications/services.py`) persists a `Notification` row and broadcasts to the user's channel group. Types include `order_update`, `new_order`, `points_earned`, `mission_completed`, `reward_redeemed`, `punch_card_completed`, `special_offer`, `transfer_sent`, `transfer_received`, `generic`.
- **Preparation realtime:** separate WebSocket `/ws/preparation/{merchant_id}/{area_id|all}/`.
- **Push:** the service worker registers `push` / `notificationclick` handlers, so a browser push message can display a notification. **However**, the backend does not include a Web-Push subscription/sending pipeline in this build — realtime delivery is WebSocket-based. Do not tell users push is guaranteed.
- **Limitation:** the channel layer defaults to in-memory; on a single-process dev server this is fine, but multiple server instances need a shared channel backend (Redis).

---

## 13. Offline and PWA Behavior

- **Installable:** yes — a PWA manifest ("Zentro — Order & Loyalty") is configured; the app listens for `beforeinstallprompt` and shows an install button. Service worker uses Workbox (injectManifest).
- **Caching:** static assets, images, and fonts are cached; public API GETs for store/menu data use a NetworkFirst strategy with a navigation fallback (an `/offline` page).
- **Which actions work offline (verified in code):**
  - The **POS** can create orders/payments while offline; they are queued in IndexedDB (`zentro-pos`: `orders`, `payments`, `sync_queue`, `menu_cache`) and synced on reconnect (background sync ~every 30 s, up to 5 retries, conflicts surfaced in `/pos/conflicts`).
  - Previously visited store/menu content may render from cache.
- **Which actions require connectivity:**
  - Customer ordering, joining merchants, rewards/redemptions, transfers, and all account actions require a live API connection.
  - The customer app does **not** have an offline order queue like the POS.
- **How users identify pending sync:** the POS shows a sync status bar; conflicting items appear in the conflicts screen.
- **Do not claim:** full offline mode for the whole app. Only POS ordering has an offline queue; the rest is PWA caching + a fallback page.

---

## 14. Data Isolation and Privacy

- **Merchant isolation:** all merchant-scoped data (menu, orders, tables, staff, shifts, rewards, missions, punch cards, wallets, customers) is filtered by `merchant` on the server. A merchant never sees another merchant's data.
- **Customer isolation:** customers only see their own memberships, wallets, orders, and notifications. Backend endpoints resolve the customer from the authenticated user (e.g., membership join does **not** accept a customer id from the client).
- **Cross-merchant restrictions:** loyalty wallets, transfers, and memberships are per merchant; cross-merchant transfers are rejected by the server.
- **Staff scoping:** POS staff are scoped to their merchant; permission flags gate discounts/refunds/shift-close/reports.
- **Guest identity:** guest orders are tied to a guest session id and optional name; no account is created.
- **Privacy principle:** the platform stores only the data needed for the loyalty/ordering flows; secrets and credentials are never exposed through public endpoints.

---

## 15. Common Questions (FAQ)

### Customer FAQs
- **How do I join a merchant?** Open the store page (e.g., scan the store QR, or search in `/customer/merchants`) and tap Join. Joining is safe to repeat — it never duplicates.
- **How do I earn points?** Order items marked as loyalty-earning at a cafe you've joined; points are credited when the order is completed. Each item shows its points value where the merchant enables it.
- **Are my points usable at other cafes?** No. Points are per merchant and cannot be transferred or combined between different cafes.
- **Why didn't my points update?** Points are added when the merchant completes/confirms the order, not when you place it. If it still doesn't show, ask the counter staff to confirm the order is completed.
- **How do I spend points?** Redeem a reward on the merchant's rewards page; the merchant must confirm the redemption.
- **How do I send points to a friend?** In `/transfers`, enter their transfer code and the amount. They must be a member of the same merchant.

### Merchant FAQs
- **How do I create a reward?** `/merchant/loyalty` → add reward: name, description, point cost, stock. You confirm redemptions from the same page.
- **How do I manage menu items?** `/merchant/menu` — add/edit/delete items, set price, category, image, availability, and points per item.
- **Why is my store not appearing publicly?** Stores must be approved (`is_approved`) and have onboarding complete. In this build merchants are auto-approved, but if a store is missing, check the admin approval flag.
- **How does my staff log in?** Enable POS in `/merchant/store`, create workers with PINs in the POS → staff, then staff log in on the POS with their PIN.

### Staff FAQs
- **I forgot my PIN / got locked out.** A merchant/manager must reset the worker's PIN (POS → staff). After 5 wrong attempts the PIN is locked automatically.
- **I can't apply a discount.** Your worker permission `can_apply_discount` is off; ask a manager/admin to enable it.

### POS FAQs
- **Do I need internet to take orders?** You can take orders offline; they sync when you reconnect. Payments and syncing need connectivity.
- **My offline order didn't sync.** Check the sync status bar; if it's stuck, go to `/pos/conflicts` and resolve it.
- **How do I open a shift?** On the POS, when shift management is enabled, open the shift with your opening cash amount before serving.

### Loyalty FAQs
- **What are tiers?** Bronze (<500 lifetime pts), Silver (500), Gold (2,000), Platinum (5,000).
- **What is a streak?** Consecutive visit periods 12–36 h apart at the same cafe; a longer gap resets it.
- **Can I transfer points across merchants?** No, only within the same merchant.

### Ordering FAQs
- **Can a guest order without an account?** Yes, from a table QR, guests can order with just a name (or anonymously); they just can't earn points.
- **Can I change an order after placing it?** Orders can be cancelled while `pending`; ask the cafe to cancel or adjust. Status transitions are enforced by the system.

### QR FAQs
- **The table QR doesn't open.** Make sure the table is active and the token is current; regenerating a table QR invalidates the old one.
- **Someone scanned my membership QR.** The QR identifies your membership at that cafe; rotate the QR (on the card) if you're concerned.

### Account FAQs
- **I can't log in.** Confirm you're using the right role page (customer login vs merchant login), check your email/password, and that your access token didn't expire (the app auto-refreshes; a hard reload usually fixes a stale session).
- **I forgot my password.** Use forgot-password. Note: email delivery depends on server SMTP configuration; if you don't receive an email, contact support.

### Troubleshooting FAQs
- **Login reloads / redirects to /auth.** The session expired or the token refresh failed. Sign in again.
- **Pages show 429 Too Many Requests.** The anonymous rate limit was hit (in this build: 500/hour per IP for unauthenticated requests). Retry later or sign in; POS device endpoints are exempt.

---

## 16. Troubleshooting Guide

| Symptom | Likely cause | User-level fix | Merchant/admin fix |
|---|---|---|---|
| Login redirects to `/auth` | Expired access/refresh token | Sign in again | — |
| "Invalid PIN" | Wrong PIN, or worker locked after 5 attempts | Try again; ask manager | Reset worker PIN (POS → staff) |
| Order doesn't appear in merchant list | Wrong status filter, or sync/queue issue | Refresh; check filter | Check status filters; on POS check conflicts/sync bar |
| QR code doesn't open | Inactive table or rotated token | Use the current QR | Re-enable table / regenerate QR |
| Points not updating | Order not completed yet | Wait for confirmation | Complete/confirm the order |
| Reward won't redeem | Out of stock or insufficient points | Check points/stock | Restock reward in `/merchant/loyalty` |
| Product image not loading | Upload failed or large file (limit ~5 MB) | Retry upload | Re-upload smaller image |
| Offline order not syncing | Network/queue issue | Go online, wait for sync | Resolve in `/pos/conflicts` |
| Customer not in merchant list | Customer never joined / search filter | — | Search by name/phone in customers page |
| 429 Too Many Requests | Anonymous rate limit | Retry later / sign in | Raise limit or whitelist (backend) |
| WebSocket "connected" but no live updates | Channel layer is in-memory/single process | Reload | Configure Redis channel layer for multi-instance |

When the above don't resolve the issue, contact Zentro support with the merchant slug and approximate time, and note whether it happened online or offline.

---

## 17. Feature Status Matrix

| Module | Feature | Customer | Merchant | Staff | Status | Last Verified | Notes |
|---|---|---:|---:|---:|---|---|---|
| Auth | Customer registration/login | ✓ | — | — | Verified | 2026-07-31 | QA test + live API |
| Auth | Merchant registration/login | — | ✓ | — | Verified | 2026-07-31 | auto-approve in build |
| Auth | Staff PIN login | — | — | ✓ | Verified | 2026-07-31 | QA test |
| Auth | Password change | ✓ | ✓ | — | Verified | 2026-07-31 | API tested |
| Auth | Forgot/reset password | ✓ | ✓ | — | Implemented, untested | 2026-07-31 | email delivery needs SMTP |
| Customer | Discover merchants | ✓ | — | — | Verified | 2026-07-31 | live 200 |
| Customer | Join merchant | ✓ | — | — | Verified | 2026-07-31 | QA test |
| Customer | Membership cards | ✓ | — | — | Partially verified | 2026-07-31 | API verified; UI not clicked in browser |
| Customer | Customer QR | ✓ | — | — | Partially verified | 2026-07-31 | endpoints tested; rotation flow code-verified |
| Customer | Loyalty points | ✓ | — | — | Verified | 2026-07-31 | QA test |
| Customer | Streaks | ✓ | — | — | Verified | 2026-07-31 | logic tested |
| Customer | Punch cards | ✓ | ✓ | — | Verified | 2026-07-31 | QA test |
| Customer | Missions (3 types) | ✓ | ✓ | — | Verified | 2026-07-31 | order_count/spend/visit_streak |
| Customer | Missions (purchase/visit/referral/special) | ✓ | ✓ | — | Not found (type only) | 2026-07-31 | model choices only, no progress logic |
| Customer | Rewards/redemption | ✓ | ✓ | — | Verified | 2026-07-31 | QA test |
| Customer | Transfers | ✓ | — | — | Verified | 2026-07-31 | QA test |
| Customer | Leaderboard | ✓ | — | — | Verified | 2026-07-31 | live 200 |
| Customer | Order history | ✓ | — | — | Verified | 2026-07-31 | QA test |
| Customer | Notifications | ✓ | — | — | Verified | 2026-07-31 | QA test + live WS |
| Customer | Today's special | ✓ | ✓ | — | Verified | 2026-07-31 | live 200 |
| Merchant | Dashboard/overview | — | ✓ | — | Verified | 2026-07-31 | analytics tests pass |
| Merchant | Orders + status flow | — | ✓ | — | Verified | 2026-07-31 | QA tests |
| Merchant | Menu CRUD | — | ✓ | — | Verified | 2026-07-31 | QA test + live 200 |
| Merchant | Specials | — | ✓ | — | Partially verified | 2026-07-31 | API OK; page has pre-existing TS error |
| Merchant | Tables + QR | — | ✓ | — | Verified | 2026-07-31 | QA test |
| Merchant | Loyalty settings | — | ✓ | — | Verified | 2026-07-31 | QA tests |
| Merchant | Customers | — | ✓ | — | Implemented, untested | 2026-07-31 | endpoints exist, no QA test |
| Merchant | Analytics | — | ✓ | — | Verified | 2026-07-31 | tests pass |
| Merchant | Preparation/KDS | — | ✓ | ✓ | Verified | 2026-07-31 | QA tests |
| Merchant | AI assistant | — | ✓ | — | Partially verified | 2026-07-31 | unit tests pass; live AI not exercised |
| Merchant | AI daily insights | — | ✓ | — | Backend only | 2026-07-31 | needs external scheduler |
| Merchant | Store settings + card design | — | ✓ | — | Partially verified | 2026-07-31 | profile update tested; design publish code-verified |
| POS | Device bootstrap | — | ✓ | — | Verified | 2026-07-31 | live device-token flow + throttle fix |
| POS | Worker CRUD + PIN | — | ✓ | ✓ | Verified | 2026-07-31 | QA test |
| POS | Shifts | — | ✓ | ✓ | Verified | 2026-07-31 | QA test |
| POS | Orders + payments + idempotency | — | ✓ | ✓ | Verified | 2026-07-31 | QA tests |
| POS | Discounts/refunds | — | ✓ | ✓ | Implemented, untested | 2026-07-31 | permission-gated; no QA test found |
| POS | Credit accounts | — | ✓ | ✓ | Implemented, untested | 2026-07-31 | backend + UI exist |
| POS | Debit accounts | — | ✓ | ✓ | Implemented, untested | 2026-07-31 | backend + UI exist |
| POS | Cash movements | — | ✓ | ✓ | Implemented, untested | 2026-07-31 | endpoints exist |
| POS | Z-report | — | ✓ | ✓ | Verified | 2026-07-31 | QA test |
| POS | Staff report/schedules | — | ✓ | ✓ | Implemented, untested | 2026-07-31 | endpoints exist |
| POS | Offline queue + sync | — | ✓ | ✓ | Partially verified | 2026-07-31 | code-verified; not e2e-exercised |
| POS | Conflict resolution | — | ✓ | ✓ | Partially verified | 2026-07-31 | code-verified |
| Ordering | Guest table order | ✓ | — | — | Verified | 2026-07-31 | QA test |
| Ordering | Customer app order | ✓ | — | — | Verified | 2026-07-31 | QA test |
| Ordering | Cancellation/status rules | ✓ | ✓ | — | Verified | 2026-07-31 | QA tests |
| PWA | Install + offline caching | ✓ | — | — | Partially verified | 2026-07-31 | build OK; install prompt UI code-verified |
| Realtime | Notification WebSocket | ✓ | ✓ | ✓ | Verified | 2026-07-31 | live WS + QA test |
| Realtime | Preparation WebSocket | — | ✓ | ✓ | Verified | 2026-07-31 | code + routing verified |
| Platform | Django admin | — | — | — | Verified | 2026-07-31 | site present; approval flag exists |
| Platform | Referral program | — | — | — | Not found | 2026-07-31 | mission type label only |
| Platform | Inventory module | — | — | — | Not found | 2026-07-31 | — |
| Platform | Multi-branch support | — | — | — | Not found | 2026-07-31 | single-store model |
| Platform | Marketing automation | — | — | — | Not found | 2026-07-31 | — |

---

## 18. Known Limitations

1. **Offline support is limited.** Only the POS has a real offline order/payment queue. The customer app is PWA-cached but all actions need connectivity.
2. **Realtime needs a shared channel backend.** The WebSocket channel layer defaults to in-memory — fine for a single-process dev server; multi-instance deployments need Redis. Without it, live notifications/prep updates won't fan out across instances.
3. **AI insights are not scheduled.** `ai_core` defines a `dispatch_due_reports` entry point for an external scheduler, but no scheduler is wired into the running app; daily AI insights won't generate by themselves. The AI chat works only with a configured provider (Groq/Gemini/Ollama).
4. **Password-reset email may not be delivered.** Default email backend is the console; SMTP env vars must be configured for real emails.
5. **Merchant auto-approval.** Merchants register with `is_approved=True` "for easier testing"; there is no manual approval gate in the running build (the flag exists and is respected by public listings).
6. **Some mission types are inert.** `purchase`, `visit`, `referral`, `special` mission types exist as model choices but have no progress logic.
7. **No referral program UI/logic**, no inventory, no multi-branch, no marketing automation (not found in code).
8. **Pre-existing frontend type errors.** `tsc --noEmit` reports errors in `src/routes/auth*.tsx` (missing `search` params on links), `src/routes/customer.order.tsx`, `src/features/catalog/pages/MerchantSpecialsPage.tsx`, `src/features/merchant-management/components/TodaySpecialPopup.tsx`, `src/features/pos/screens/ShiftCloseScreen.tsx`. The production build still succeeds (Vite transpiles without type-checking).
9. **Rate limiting.** Anonymous requests are limited to 500/hour per IP; high-frequency unauthenticated browsing can still hit 429 temporarily. POS device endpoints are exempt.
10. **Image uploads** are limited to ~5 MB.
11. **No email/SMS OTP**, no in-app email change, no self-service merchant deactivation flow found.
12. **Not fully exercised:** offline replay, credit/debit account flows, refunds/discounts, staff schedules/reports, card-design publish — implemented but not end-to-end tested in this audit.

---

## 19. Planned Features

Only items that exist as explicit model/API hooks or placeholders — **not** advertised as available:

- **Daily AI merchant insights** (`/api/ai/insights/daily/` + generator): backend complete, but requires an external scheduler and AI credentials. Not yet end-to-end active.
- **Mission types** `purchase`, `visit`, `referral`, `special`: listed in the mission model but no progress wiring exists — treat as planned.
- **Referral program:** only the `referral` mission label exists; no referral code, link, or credit logic. Planned/not implemented.

No approved product roadmap document was found in the repo; the items above are inferred strictly from code. Do not present any other capability as "planned" without evidence.

---

## 20. Safe Technical Reference

Purpose: a non-secret map for AI/support internal verification. No secrets, credentials, or private values included.

### 20.1 Frontend route groups

| Route prefix | Purpose | Layout file |
|---|---|---|
| `/` | Customer home dashboard | `src/routes/index.tsx` |
| `/auth*` | Customer + merchant auth | `src/routes/auth.tsx`, `auth.merchant.tsx` |
| `/customer/*` | Merchant discovery, merchant page | `customer.merchants.tsx`, `customer.merchant.$slug.tsx` |
| `/menu`, `/cart` | Customer ordering | `menu.tsx`, `cart.tsx` |
| `/loyalty`, `/cards*`, `/rewards`, `/missions`, `/leaderboard`, `/transfers` | Loyalty features | `src/features/loyalty-engine/...` |
| `/m/:slug*` | Public store entry (guest landing + table ordering) | `m.$slug.tsx`, `m.$slug.table.$token.tsx` |
| `/table/:token/order` | Public guest ordering | `table.$token.order.tsx` |
| `/guest/merchant/:slug` | Guest merchant page | `guest.merchant.$slug.tsx` |
| `/merchant*` | Merchant dashboard (auth-guarded) | `merchant.tsx` + `merchant.*.tsx` |
| `/pos*` | POS (device auth + PIN + shift) | `pos.tsx` + `src/features/pos/screens/*` |
| `/offline` | Offline fallback page | `offline.tsx` |
| `/orders/:id`, `/customer/orders` | Order detail / history | `orders.$id.tsx`, `customer.orders.tsx` |

Auth guards: `src/lib/auth-guard.ts`, `src/lib/merchant-auth-guard.ts`; auth context `src/lib/auth.tsx`; legacy customer store `src/lib/store.ts`; POS store `src/features/pos/store.ts`; API clients in `src/lib/api/*.ts`; PWA `src/features/pwa/*`, service worker `src/service-worker.ts`.

### 20.2 Backend API groups

| Prefix | Purpose | Key modules |
|---|---|---|
| `/api/auth/` | Register, login, refresh, logout, me, password, upload | `backend/accounts/` |
| `/api/merchants/` | Merchant profile, menu items, tables, analytics, public discovery | `backend/merchants/views.py` |
| `/api/loyalty/` | Wallets, rewards, missions, punch cards, transfers, leaderboard, redemptions | `backend/loyalty/views.py`, `services.py` |
| `/api/customer/memberships/` | Membership join/list/detail/QR | `backend/loyalty/customer_urls.py` |
| `/api/orders/` | Customer/guest orders, status, prep routing | `backend/orders/views.py`, `services/preparation.py`, `preparation_views.py` |
| `/api/notifications/` | Notification center + WebSocket | `backend/notifications/` |
| `/api/pos/` | Device auth, workers, shifts, orders, payments, credit/debit, reports, conflicts, table QR | `backend/pos/views.py`, `permissions.py` |
| `/api/ai/` | Merchant assistant chat, daily insights | `backend/ai_core/api/` |
| `/healthz/`, `/admin/` | Health check, Django admin | `backend/config/urls.py` |

### 20.3 Django apps and data relationships

- `accounts` — `User` (roles), `CustomerProfile` (transfer_code), `PasswordResetToken`.
- `merchants` — `MerchantProfile` (1:1 user, POS/loyalty flags), `MenuItem` (FK merchant, optional prep area), `RestaurantTable` (public_token).
- `loyalty` — `CustomerMerchantProfile` (membership), `CustomerMerchantWallet` (per customer+merchant), `PointTransaction`, `Reward`/`Redemption`, `MerchantPunchCard`/`CustomerPunchCard`, `Mission`/`CustomerMission`, `LoyaltyRules`, `TodaySpecial`, `MembershipQrToken`, `MerchantMembershipCardDesign`.
- `orders` — `Order` (status/fulfillment/source/type, FKs to merchant, customer, redemption, punch card), `OrderItem` (menu snapshot, prep area + status), `PreparationArea`.
- `pos` — `PosDevice`, `ShiftWorker` (PIN, roles, permission flags), `CashShift`, `PosPayment`, `PosDiscount`, `PosAuditLog`, `ProcessedClientMutation`, `CreditAccount`/`CreditTransaction`, `DebitAccount`/`DebitTransaction`, `StaffSchedule`, `PosCashMovement`, `StaffPreparationArea`.
- `notifications` — `Notification`; WS consumers `NotificationConsumer` (`user_{id}`) and `PreparationConsumer` (`merchant_{id}_preparation_{area}`).
- `ai_core` — `AIRequest`, `AIArtifact`, `AIConversation`/`AIConversationMessage`; gateway/providers (Groq, Gemini, Ollama); tools + registry; scheduler entry point.

Key service boundaries: `loyalty/services.py` (wallets/points/transfers), `orders/views.py:_award_loyalty/_deduct_reward_redemption_points` (loyalty on completion), `orders/services/preparation.py` (KDS routing), `notifications/services.py` (persist + broadcast), `pos` (device/worker/shift/orders/payments), `ai_core/gateway` (model routing).

### 20.4 Background tasks and realtime

- **django-q2** is configured (ORM broker) but **no scheduled jobs are registered in code**; `ai_core.tasks.scheduler.dispatch_due_reports` is the intended external scheduler entry point for daily insights.
- **Celery is not configured** anywhere in the backend.
- **Realtime:** two WebSockets (`/ws/notifications/`, `/ws/preparation/...`) using Django Channels; channel layer in-memory by default.

### 20.5 Environment variables (names only)

Required/configurable names: `DJANGO_SETTINGS_MODULE`, `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `DATABASE_URL` / `DB_ENGINE` (+ `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_SSLMODE`), `REDIS_URL`, `CORS_ALLOWED_ORIGINS`, `FRONTEND_URL`, `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OLLAMA_BASE_URL`, `AI_INSIGHTS_MODEL`, `AI_CHAT_MODEL`. Frontend: `VITE_DJANGO_API_BASE_URL`. (Values intentionally omitted.)

---

## 21. Glossary

| Term | Definition |
|---|---|
| Merchant | A cafe/restaurant account (business) on Zentro. |
| Customer | A registered user account that joins merchants and earns loyalty. |
| Guest | An unauthenticated person ordering via a table QR. |
| Staff | A merchant's POS worker (cashier/waiter/manager/admin) with a PIN. |
| Membership | The link between one customer and one merchant (with a membership number). |
| Loyalty points | Merchant-scoped points earned on eligible items when an order completes. |
| Reward | A merchant-created item (or prize) a customer can spend points on. |
| Mission | A goal (order count / spend / streak) that pays bonus points. |
| Punch card | Stamp-based loyalty (per order or per streak). |
| Streak | Consecutive visit periods 12–36 h apart at one merchant. |
| Table QR | A per-table QR code that opens the table's ordering page. |
| Guest order | An order placed without an account via a table QR. |
| Shift | A staff working session with opening/closing cash reconciliation. |
| POS | Point-of-sale: the merchant's order/payment screen. |
| PWA | Progressive web app: installable web app with caching and offline fallback. |
| Pending sync | Offline POS orders/payments waiting in the queue to upload. |
| Merchant slug | The URL-friendly store identifier (e.g., `chiya`). |
| Transfer code | A code a customer shares to receive points from another customer of the same merchant. |

---

## 22. AI Assistant Answering Rules

1. **Primary source:** use this knowledge base before anything else; it reflects verified behavior at commit `afb3f94`.
2. **Never invent a feature.** If it isn't here (or in verified code), say it isn't available rather than guessing.
3. **Current vs planned:** keep implemented and planned items separate (see sections 17–19).
4. **No secrets:** never reveal credentials, tokens, PINs, private keys, environment values, or internal signing logic.
5. **No cross-merchant data:** never share or describe one merchant's data in the context of another.
6. **Identify safely:** if a merchant or account can't be identified safely, ask for clarification (e.g., merchant slug, store name, email at `****` level) instead of guessing.
7. **Unverified = unverified:** when a flow is only partially verified, say so plainly (e.g., "the offline sync flow exists but hasn't been fully end-to-end verified").
8. **Don't claim fixes without confirmation:** report what is implemented and tested; don't promise a bug is fixed unless it was verified.
9. **Prefer step-by-step guidance** over conceptual descriptions when a user is trying to do something.
10. **Escalate:** account-specific, security, or payment issues → human support. Never instruct users to bypass permissions or share credentials.
11. **Never expose another user's information,** including balances, orders, or contact details.
12. **Loyalty clarity:** always make clear that points are per-merchant and non-transferable between merchants.
