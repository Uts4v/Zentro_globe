# ZENTRO GLOBE — PRODUCTION SYSTEM AUDIT REPORT
**Target Application:** Zentro Globe (Restaurant Loyalty, Online Ordering, Inventory & POS System)  
**Workspace:** `c:\Zentro_globe`  
**Audit Type:** Full-Stack Defensive Security, Architecture, Performance & Code Quality Review  
**Mode:** Inspection & Testing Only (Read-Only; Zero Source Code or DB Modifications)  
**Date:** September 30, 2026  

---

## TABLE OF CONTENTS
1. [A. Executive Summary](#a-executive-summary)
2. [B. Complete Project Inventory](#b-complete-project-inventory)
3. [C. Page & Route Audit](#c-page--route-audit)
4. [D. Functionality Audit](#d-functionality-audit)
5. [E. User Flow Audit](#e-user-flow-audit)
6. [F. UI/UX Audit](#f-uiux-audit)
7. [G. Responsive Design Audit](#g-responsive-design-audit)
8. [H. Accessibility (WCAG 2.1 AA) Audit](#h-accessibility-wcag-21-aa-audit)
9. [I. Frontend Code Quality Audit](#i-frontend-code-quality-audit)
10. [J. Backend Code Quality Audit](#j-backend-code-quality-audit)
11. [K. API Endpoint Audit](#k-api-endpoint-audit)
12. [L. Authentication & Authorization Audit](#l-authentication--authorization-audit)
13. [M. Defensive Security Audit](#m-defensive-security-audit)
14. [N. Database Schema & Integrity Audit](#n-database-schema--integrity-audit)
15. [O. Business Logic & Pricing Engine Audit](#o-business-logic--pricing-engine-audit)
16. [P. Offline & Background Sync Engine Audit](#p-offline--background-sync-engine-audit)
17. [Q. Performance & Core Web Vitals Audit](#q-performance--core-web-vitals-audit)
18. [R. SEO & Crawlability Audit](#r-seo--crawlability-audit)
19. [S. Image & Media Asset Audit](#s-image--media-asset-audit)
20. [T. Error Handling & Resilience Audit](#t-error-handling--resilience-audit)
21. [U. Deployment & Production Readiness Audit](#u-deployment--production-readiness-audit)
22. [V. Dependency & Licensing Audit](#v-dependency--licensing-audit)
23. [W. Automated Testing & Verification Audit](#w-automated-testing--verification-audit)
24. [X. Codebase Cleanliness Audit](#x-codebase-cleanliness-audit)
25. [Y. Monitoring & Observability Audit](#y-monitoring--observability-audit)
26. [Z. Individual Remediation Issue Cards](#z-individual-remediation-issue-cards)
27. [Final Prioritized Issue Table](#final-prioritized-issue-table)
28. [Pass / Fail Summary](#pass--fail-summary)

---

## A. EXECUTIVE SUMMARY

An exhaustive, production-readiness audit of the **Zentro Globe** platform was executed across the frontend (TanStack Start / React 19 / Vite), backend (Django 5.0+ / DRF / Channels / ASGI Daphne), databases (SQLite / PostgreSQL 16), caching (Redis 7), and PWA offline infrastructure.

### Key Strengths Verified
1. **Deterministic Authoritative Pricing:** The server-side pricing engine (`backend/orders/pricing/engine.py`) and matching client preview (`src/lib/pricing/preview.ts`) passed **100% (18/18) of golden test vectors**, correctly computing compound tax components, line item discount distributions, non-taxable service charges, and minimum spend boundaries.
2. **Hardened Media Pipeline:** Server-side upload handlers in `backend/config/media_utils.py` verify magic bytes, enforce pixel dimensions, guard against decompression bombs, sanitize and rasterize SVG vectors to PNG, and re-encode all images via Pillow. Media serving (`backend/config/views.py`) strictly enforces sandbox CSP, `X-Content-Type-Options: nosniff`, and path traversal prevention.
3. **Database Migration Health:** All 85 Django migrations across all 11 applications are cleanly synchronized and fully applied (`[X]`).
4. **TypeScript Strictness:** Full workspace static type checking (`npx tsc --noEmit`) completed with **0 type errors**.

### Critical Production Blockers
1. **Table QR Guest Orders & Public Stores Blocked by AuthGate (P0 / Critical):** In `src/routes/__root.tsx` (lines 30–61), `PUBLIC_ROUTES` is limited to auth pages. Table QR scan URLs (`/m/$slug/table/$token`), guest storefronts (`/guest/merchant/$slug`), the store directory (`/stores`), and offline fallback (`/offline`) are omitted. Any unauthenticated diner scanning a physical table QR code is forcibly redirected to `/auth`, breaking in-restaurant table ordering.
2. **Missing Guest Order Tracking Endpoint (P0 / Critical):** Guest orders created via `POST /api/orders/guest-create/` set `order.customer = None`. However, the order detail endpoint `GET /api/orders/<int:pk>/` requires authentication and enforces `order.customer == request.user.customer_profile`, resulting in `401 Unauthorized` or `403 Forbidden`. Guests cannot track the progress of their food or drinks.
3. **POS Payment Completion Failure Under Default Tax Configuration (P1 / High):** Verified by test failure in `backend/qa_test.py` (`test_43_pos_order_and_payment`). Because `tax_enabled` defaults to `True` on `MerchantProfile`, orders include calculated tax. Payments tendered for subtotal only leave the order in `payment_status="partially_paid"` and `status="confirmed"`, blocking auto-completion and loyalty awards.
4. **Asset Bloat (P1 / High):** `public/favicon.png` is **2.17 MB**, and multiple unoptimized raster assets exist in `public/` (e.g. `hero-bg.jpg` 846 KB, `asset-sheet.png` 946 KB), causing severe mobile FCP and LCP degradation.
5. **No Robots.txt, Sitemap, or Public Landing Route (P1 / High):** The root route `/` enforces `beforeLoad: requireAuth`, bouncing search engine crawlers to `/auth`. No `robots.txt` or `sitemap.xml` exists, rendering the platform invisible to search engine indexers.

---

## B. COMPLETE PROJECT INVENTORY

### Core Architecture
- **Frontend:** TanStack Start (`@tanstack/react-start` v1.167.50) + TanStack Router v1.168.25
- **UI & State:** React 19 (`react` v19.2.0, `react-dom` v19.2.0), Zustand v5.0.14, `@tanstack/react-query` v5.83.0
- **Styling:** Tailwind CSS v4 (`@tailwindcss/vite` v4.2.1, `tailwindcss` v4.2.1), Radix UI primitives, Lucide React v0.575.0
- **PWA & Offline:** `vite-plugin-pwa` v1.3.0, custom service worker (`src/service-worker.ts`), IndexedDB client store (`src/features/pos/offline/db.ts`)
- **Backend Framework:** Django 5.x / Django REST Framework 3.15+ (ASGI via Daphne 4.x / Channels 4.x)
- **Admin System:** Django Unfold v0.104+
- **Authentication:** DRF SimpleJWT (Native asymmetric/symmetric JWT; Supabase fully detached) + Google OAuth ID Token verification + SMS OTP via Twilio/Vonage/Console
- **Database:** SQLite (dev / zero-config via `db.sqlite3`) / PostgreSQL 16 (production via `DATABASE_URL`)
- **Caching & Brokers:** Redis 7 (via `django.core.cache.backends.redis.RedisCache` & `channels_redis`)
- **Document / PDF Engine:** PyMuPDF (`pymupdf` v1.24+) for menu and inventory report generation
- **AI Core:** Google Gemini API (`google-generativeai`) + Groq Cloud API (`llama-3.1-8b-instant`)

### User Roles
1. **Anonymous / Visitor:** Browsing nearby cafes, scanning QR codes, viewing digital PDF menus, placing guest table orders.
2. **Customer:** Member loyalty card, earning/redeeming points, wallet, punch cards, order history, PWA push alerts.
3. **Merchant (Owner / Manager):** Storefront config, table QR generation, menu CRUD, pricing policies, analytics, inventory management, offers, staff scheduling.
4. **POS Shift Worker (Cashier / Waiter):** Cash register, shift open/close, order punching, split tenders, offline queue, receipt printing.
5. **Kitchen / Bar Staff:** Preparation areas / KDS terminal, marking items ready, KOT ticket management.
6. **Platform Superuser:** Django Admin, system health monitor, developer database browser (`/__db__/`).

### Unused Code & Technical Debt
- **Dead Route:** `src/routes/stores_.$id.tsx` (`/stores_/$id`) contains a typo with a trailing underscore. It is unlinked across the entire codebase.
- **Dead Route:** `src/routes/customer.order.tsx` (`/customer/order`) is an abandoned screen that unconditionally redirects to `/`.
- **Duplicate Implementation:** `src/routes/leaderboard.tsx` completely duplicates the 223-line component `src/features/loyalty-engine/pages/LeaderboardPage.tsx`.
- **Abandoned / Stale File:** `src/lib/supabase.ts` is an empty 0-byte file left over after the Django migration.
- **Abandoned Folder:** `supabase/migrations/` contains obsolete PostgreSQL SQL files no longer referenced by the Django ORM.
- **Repository Cleanliness Issues:**
  - `c:\Zentro_globe\exit`: Leaked git-log terminal stdout dump (1.8 KB).
  - `c:\Zentro_globe\test_register.py`: Ad-hoc test script containing hardcoded dummy credentials.
  - `backend/db.sqlite3.bak` (503 KB) and `backend/db.sqlite3.pre-payment-qr.bak` (1.88 MB): Binary database dumps stored in the workspace.
  - `backend/script.sql`: Stray database inspection query snippet.

---

## C. PAGE & ROUTE AUDIT

| Route Path | Auth Required | Target Role | Inspection Result | Status | Key Finding |
|---|---|---|---|---|---|
| `/` | Yes | Customer | Verified | PASS | Renders customer dashboard; blocks public search crawlers. |
| `/auth/*` | No | Public | Verified | PASS | Login, registration, password reset, and OAuth function. |
| `/m/$slug/table/$token` | No (Intended) | Public Diner | Verified | **FAIL** | Blocked by `AuthGate` in `__root.tsx`; redirects guests to `/auth`. |
| `/m/$slug` | No (Intended) | Public Diner | Verified | **FAIL** | Blocked by `AuthGate` in `__root.tsx`; redirects guests to `/auth`. |
| `/guest/merchant/$slug` | No (Intended) | Public Diner | Verified | **FAIL** | Blocked by `AuthGate` in `__root.tsx`; redirects guests to `/auth`. |
| `/stores_/$id` | Yes | Customer | Verified | **FAIL** | Dead route with typo in filename; never linked internally. |
| `/customer/order` | Yes | Customer | Verified | **FAIL** | Deprecated stub that immediately bounces to `/`. |
| `/orders/$id` | Yes | Customer | Verified | **PARTIAL** | Fails for guest table orders; guest users cannot track orders. |
| `/map` | Yes | Customer | Verified | **PARTIAL** | Requires registration; anonymous visitors cannot view cafe map. |
| `/stores` | No (Intended) | Public Diner | Verified | **FAIL** | Missing from `PUBLIC_ROUTES`; redirects visitors to `/auth`. |
| `/merchant/*` | Yes (Merchant) | Merchant Staff | Verified | PASS | Role validation enforced; redirects unapproved/unboarded users. |
| `/pos/*` | Yes (Merchant) | POS Worker | Verified | PASS | PIN protection, device registration, and cash shifts function properly. |
| `/pos/preparation` | Yes (Merchant) | Kitchen/Bar | Verified | PASS | KDS display auto-routes items based on assigned area. |
| `/offline` | No (Intended) | Public / All | Verified | **FAIL** | Missing from `PUBLIC_ROUTES`; redirects offline users to `/auth`. |

---

## D. FUNCTIONALITY AUDIT

### Automated QA Test Run Summary (`backend/qa_test.py`)
Execution of the comprehensive Django test suite produced **31 PASSES and 2 FAILURES**:

```
Ran 33 tests in 70.985s
FAILED (failures=2)
```

1. **PASS:** Customer registration, login, token refresh, `/api/auth/me/` retrieval.
2. **PASS:** Merchant profile registration and approval flags.
3. **PASS:** Role isolation (Customer accounts denied access to merchant endpoints with 403 Forbidden).
4. **PASS:** Customer joining merchant programs, generating unique membership numbers.
5. **PASS:** Public menu retrieval and catalog serialization.
6. **PASS:** Order lifecycle transitions (Pending → Confirmed → Preparing → Ready → Completed).
7. **PASS:** Order cancellation restrictions (transitions strictly validated against `VALID_TRANSITIONS`).
8. **PASS:** Reward creation, point redemption, and merchant confirmation.
9. **PASS:** Point transfer between customers using 6-character transfer codes.
10. **PASS:** Mission tracking and automated point grants.
11. **PASS:** POS device registration with UUID tokens.
12. **PASS:** Shift worker PIN authentication and role mapping.
13. **PASS:** Cash shift open, float balance, and cash shift close reconciliation.
14. **PASS:** Idempotency via `client_mutation_id` in POS payment and order endpoints.
15. **PASS:** Z-Report generation and tax/tender summarization.
16. **PASS:** Preparation area routing (bar vs kitchen) and staff assignments.
17. **PASS:** In-app notification creation and mark-as-read lifecycle.
18. **PASS:** Health check endpoint (`/healthz/`).
19. **FAIL (`test_81_merchant_public_profile`):** Public slug endpoint `GET /api/merchants/slug/<slug>/` returned `404 Not Found` for unapproved merchant profiles due to hardcoded `is_approved=True` filter.
20. **FAIL (`test_43_pos_order_and_payment`):** `Order.status` remained `'confirmed'` instead of `'completed'` following payment because tax calculation made `order.total_amount` higher than the paid subtotal.

---

## E. USER FLOW AUDIT

### 1. In-Restaurant Table QR Ordering Flow (FAIL)
- **Intended Flow:** Diner sits at table → Scans table QR code (`/m/:slug/table/:token`) → Menu resolves with table number banner → Selects items and options → Places guest order.
- **Failure Root Cause:** `src/routes/__root.tsx` executes before route components mount. Since `PUBLIC_ROUTES` excludes `/m`, unauthenticated diners are bounced to `/auth`.
- **Severity:** P0 / Critical.

### 2. Guest Order Status Polling Flow (FAIL)
- **Intended Flow:** Guest order submitted → App redirects to `/orders/:id` → Status updates via polling (Pending → Confirmed → Brewing → Ready).
- **Failure Root Cause:** `src/routes/orders.$id.tsx` enforces `requireAuth`. Concurrently, `GET /api/orders/<id>/` enforces `order.customer == request.user.customer_profile`. With `order.customer = None`, the API returns `403 Forbidden`.
- **Severity:** P0 / Critical.

### 3. POS Order & Split Payment Flow (PASS with caveat)
- **Flow:** Worker opens shift → Punches cart items → Tenders split payment (Cash + Fonepay QR) → Order moves to Completed → Loyalty awarded.
- **Caveat:** If cashier tenders exact item subtotal while `tax_enabled=True`, order stalls at `partially_paid`.

### 4. Reward Redemption & Voucher Burning (PASS)
- **Flow:** Customer selects reward → Spends points → Single-use alphanumeric code with 15-minute countdown is generated → Merchant confirms via store PIN → Voucher marked burnt. Verified clean.

---

## F. UI/UX AUDIT

1. **Desktop Framing Constraints:** On desktop screens (>1024px), customer views (`src/components/MobileShell.tsx`) default to a narrow `max-w-[460px]` phone column centered on the screen, surrounded by massive unused margins.
2. **Missing Loading States in Long-Running Actions:** The AI Menu Scanner (`src/routes/merchant.ai.tsx`) takes 15–30 seconds to parse multi-page PDFs or image menus. The UI displays a simple spinner without progress milestones, leaving users uncertain if the request is still alive.
3. **Toast and Error Presentation:** Form validation errors are nicely parsed into readable strings (`Field: Error message`) by `src/lib/django-api-base.ts`, preventing raw technical errors from surfacing to end users.

---

## G. RESPONSIVE DESIGN AUDIT

1. **Mobile (<375px):** Floating capsule navigation in `src/components/MobileShell.tsx` packs 7 items horizontally. On screens under 360px width, touch targets drop below 44px, causing touch overlap.
2. **Tablet (768px):** Clean responsiveness; modal sheets and POS category grids adapt effectively.
3. **Desktop (1024px–1920px):** Merchant dashboard utilizes full-screen layouts. Customer-facing pages without `wide={true}` render in an oversized mobile simulator frame in the screen center.

---

## H. ACCESSIBILITY (WCAG 2.1 AA) AUDIT

1. **Missing Skip Navigation (WCAG 2.4.1):** `src/routes/__root.tsx` does not provide a `"Skip to main content"` anchor link, forcing keyboard users to tab through all navigation items on every page transition.
2. **Icon Buttons Missing Descriptive Labels (WCAG 4.1.2):** Several action buttons (e.g. theme toggle in `MobileShell.tsx` line 306, POS delete row buttons) lack `aria-label` attributes.
3. **Contrast Ratios (WCAG 1.4.3):** Subtitle text styled with `text-muted-foreground` against `#F3EFEA` (`bg-mist`) falls below the required 4.5:1 contrast ratio.

---

## I. FRONTEND CODE QUALITY AUDIT

1. **Side Effect Inside `useMemo`:** In `src/routes/__root.tsx` (lines 173–175), `router.options.context` is mutated directly inside a `useMemo` block. In React 19, side effects must be declared within `useEffect`.
2. **Monolithic Component:** `src/routes/merchant.store.tsx` spans **1,561 lines** in a single file, coupling state for image uploads, map picking, business hours, and store branding into one component.
3. **Duplicate Dependency Overhead:** `package.json` installs three separate QR code libraries (`html5-qrcode`, `qrcode`, and `qrcode.react`).

---

## J. BACKEND CODE QUALITY AUDIT

1. **Request Lifecycle Observability:** `backend/config/middleware.py` generates request IDs, logs client user agent context, and records warning telemetry on queries exceeding 1 second.
2. **Transaction Isolation:** Financial mutations (e.g. POS debit account deductions in `backend/pos/views.py`, point transfers) employ `@transaction.atomic` combined with `select_for_update()` to prevent race conditions.
3. **Secure File Serving:** `backend/config/views.py` validates requested media paths against `settings.MEDIA_ROOT`, rejecting traversal attempts (`..`) and applying sandboxed CSP headers.

---

## K. API ENDPOINT AUDIT

| Method | Endpoint | Auth | Role | Validation | Risk / Finding |
|---|---|---|---|---|---|
| `POST` | `/api/auth/register/` | No | Any | `RegisterSerializer` | Validates email uniqueness, password confirmation. PASS. |
| `POST` | `/api/auth/login/` | No | Any | `CustomTokenObtainPairSerializer` | Returns access + refresh tokens. Scoped rate limit enforced. PASS. |
| `GET` | `/api/merchants/slug/<slug>/` | No | Any | Slug param | **Fails with 404 if merchant `is_approved=False`.** |
| `POST` | `/api/orders/guest-create/` | No | Any | `CreateGuestOrderSerializer` | Validates table token & store status. PASS. |
| `GET` | `/api/orders/<id>/` | Yes | Owner | PK param | **Fails for guests (401/403). No guest tracking access.** |
| `POST` | `/api/pos/order/create/` | Yes | Merchant/Staff | `PosOrderSerializer` | Enforces `client_mutation_id` idempotency. PASS. |
| `POST` | `/api/pos/payment/create/` | Yes | Merchant/Staff | `PosPaymentSerializer` | **Stalls order at `partially_paid` if tendered amount ignores tax.** |
| `POST` | `/api/inventory/reconcile/` | Yes | Owner/Manager | `CountReconcileSerializer` | Verifies stock count approval and updates balance atomically. PASS. |

---

## L. AUTHENTICATION & AUTHORIZATION AUDIT

1. **Local Storage Session Tokens:** `src/lib/django-api-base.ts` stores both `dja` (access token) and `djr` (refresh token) in browser `localStorage`. Any XSS script can exfiltrate tokens and maintain unauthorized access for 30 days. Refresh tokens should be migrated to `HttpOnly`, `SameSite=Lax` cookies.
2. **Access Token Lifespan:** Set to 15 minutes in production (`backend/config/settings.py` line 378), with automated rotation and token blacklisting upon refresh.
3. **Role Enforcement:** Multi-tier authorization guards:
   - Frontend: `requireAuth`, `requireCustomer`, `requireMerchant` check JWT payload claims.
   - Backend: DRF permissions (`IsAuthenticated`, `IsMerchantUser`, `IsPosEnabled`, `InvPerm`) strictly check permissions on every endpoint.

---

## M. DEFENSIVE SECURITY AUDIT

1. **SQL Injection Assessment:** **PASSED.** All database queries use the Django ORM. The only raw query in production code is `cursor.execute("SELECT 1")` in `backend/config/views.py`.
2. **Developer SQL Explorer (`/__db__/`):** Located in `backend/config/db_browser.py`. Enabled **only when `settings.DEBUG = True`** (`backend/config/urls.py` line 42) and strictly protected by `@user_passes_test(lambda u: u.is_superuser and u.is_staff)`. It is completely unmounted in production.
3. **Exposed Credentials in Examples:** `c:\Zentro_globe\.env.example` commits a full Supabase JWT anon key. Even though Supabase is no longer the active auth provider, active keys should not be committed to source control.
4. **CORS Hardening:** `CORS_ALLOW_ALL_ORIGINS` defaults to `False` in production, with credentials disabled whenever wildcard origins are used. In development (`DEBUG=True`), origin regexes allow dynamic localhost ports.

---

## N. DATABASE SCHEMA & INTEGRITY AUDIT

1. **Constraint Inefficiency on Nullable Foreign Keys:** In `backend/orders/models.py` (lines 355–361):
   ```python
   models.UniqueConstraint(
       fields=["customer", "merchant", "client_mutation_id"],
       condition=~models.Q(client_mutation_id__isnull=True),
       name="uniq_customer_merchant_mutation",
   )
   ```
   Because `customer` is `NULL` for walk-in POS sales and guest table orders, standard SQL rules treat `NULL` as distinct from other `NULL` values. This constraint fails to prevent duplicate orders with the same `client_mutation_id` when `customer` is null.
2. **Index Coverage:** High-frequency query paths (`merchant + -created_at`, `merchant + status + -created_at`, `customer + -created_at`, `identifier + purpose + is_used`) have explicit compound B-tree indexes defined.

---

## O. BUSINESS LOGIC & PRICING ENGINE AUDIT

1. **Tax Inclusive vs Exclusive Calculations:**
   - Under `tax_policy = "exclusive"`, taxes are added to the line total.
   - Under `tax_policy = "inclusive"`, taxes are extracted from the line price without increasing the subtotal.
   - The pricing engine adheres to this strictly across all 18 test vectors.
2. **Reward Anti-Loop Guarantee:** A reward item earns 0 points and cannot trigger punch card stamps. This prevents circular earning loops.
3. **Hardcoded Currency Field Name:** `backend/loyalty/models.py` (line 277) names the points conversion rate `points_per_npr`, conflicting with multi-currency merchant configurations (`USD`, `INR`, `EUR`, `GBP`).

---

## P. OFFLINE & BACKGROUND SYNC ENGINE AUDIT

1. **IndexedDB Architecture:** `src/features/pos/offline/db.ts` creates four local object stores: `orders`, `payments`, `sync_queue`, and `menu_cache`.
2. **Order-Payment Dependency Linking:** In `src/features/pos/offline/sync.ts` (lines 68–75), when an offline order syncs and receives a server UUID/ID, the engine scans pending payments in the queue and updates their `order_id` before processing, preventing orphaned payments.
3. **Backoff & Retry:** Failed syncs use exponential backoff with random jitter up to 5 minutes, capping out at `MAX_RETRIES = 5`.

---

## Q. PERFORMANCE & CORE WEB VITALS AUDIT

1. **Asset Weight:**
   - `public/favicon.png` is **2.17 MB**; should be a compressed 32x32 PNG (<5 KB).
   - `public/hero-bg.jpg` is **846 KB**; should be converted to WebP/AVIF (<80 KB).
   - `public/pagoda/asset-sheet.png` is **946 KB**.
2. **Bundle Chunking:** Rollup chunking in `vite.config.ts` (lines 18–27) splits `vendor-react`, `vendor-react-dom`, `vendor-radix`, and `vendor-tanstack`, keeping the main entry bundle at ~381 kB (114 kB gzip).
3. **Cache Policy:** WhiteNoise serves compiled static files with `CompressedManifestStaticFilesStorage` and far-future `Cache-Control` headers.

---

## R. SEO & CRAWLABILITY AUDIT

1. **Search Engine Indexability (CRITICAL):**
   - No `public/robots.txt` exists.
   - No `public/sitemap.xml` exists.
   - Root URL `/` redirects unauthenticated users to `/auth`. Search engine crawlers receive a redirect and index nothing.
2. **Missing Canonical Tags:** None of the 74 frontend routes output `<link rel="canonical" href="...">`.
3. **Missing Open Graph / Twitter Image Metadata:** `src/routes/__root.tsx` (lines 129–139) omits `og:image`, `og:url`, `twitter:image`, and `twitter:description`. Shared links in chat apps display without preview thumbnails.

---

## S. IMAGE & MEDIA ASSET AUDIT

1. **Oversized Static Files in `public/`:**
   - `public/favicon.png`: 2,171,194 bytes (2.17 MB)
   - `public/pagoda/asset-sheet.png`: 946,797 bytes (946 KB)
   - `public/hero-bg.jpg`: 846,025 bytes (846 KB)
   - `public/pagoda/ui-mock.png`: 662,204 bytes (662 KB)
2. **WebP/AVIF Optimization:** Dynamic uploaded images are correctly re-encoded to WebP or JPEG via `backend/config/media_utils.py`, but static assets in `public/` have not been converted to modern formats.

---

## T. ERROR HANDLING & RESILIENCE AUDIT

1. **SSR Error Handling:** `src/server.ts` (lines 23–38) contains `normalizeCatastrophicSsrResponse` to catch and normalize silent 500 errors thrown by the Nitro/h3 runtime.
2. **Client Error Boundary:** `src/routes/__root.tsx` (lines 88–111) defines an `ErrorComponent` that renders user-friendly copy and provides a "Try again" action that calls `router.invalidate()`.
3. **Silent Failure in Password Reset:** In `backend/accounts/views.py` (line 353), `send_mail` uses `fail_silently=True`. If the SMTP server drops the connection, no alert is raised and the user never receives their reset email.

---

## U. DEPLOYMENT & PRODUCTION READINESS AUDIT

1. **Docker Container Configuration:**
   - Multi-stage builds in `Dockerfile.backend` and `Dockerfile.frontend` minimize final image size.
   - Non-root user execution is not configured; containers run as `root`.
2. **Database Migration on Startup:** `Dockerfile.backend` (line 51) runs `python manage.py migrate --noinput` directly in the container `CMD`. In multi-instance deployments (e.g. AWS ECS, Kubernetes), concurrent container boots will execute migrations simultaneously, risking race conditions. Migrations should be handled in a dedicated pre-deploy step.

---

## V. DEPENDENCY & LICENSING AUDIT

1. **Beta Package in Production:** `package.json` (line 99) pins `"nitro": "3.0.260603-beta"`. Beta dependencies can introduce unexpected breaking changes during builds.
2. **Legal / Licensing Alert (PyMuPDF):** `backend/requirements.txt` (line 18) depends on `pymupdf>=1.24`. PyMuPDF is licensed under **GNU AGPLv3** (or commercial). In commercial SaaS deployments, AGPL libraries can impose copyleft disclosure requirements unless a commercial license is procured.
3. **Deprecated SDK:** `google-generativeai>=0.8` is deprecated by Google in favor of the new `google-genai` SDK.

---

## W. AUTOMATED TESTING & VERIFICATION AUDIT

1. **Backend Test Suite:** Strong test coverage across orders, POS, pricing, offers, and loyalty engine (33 tests in `qa_test.py` plus 40+ unit test files).
2. **Frontend Test Suite (SEVERE DEFICIENCY):** The frontend contains only **a single test file** (`src/lib/pricing/preview.test.ts`). There are **zero tests** for:
   - 74 routes
   - Auth guards & session refresh logic
   - Cart & checkout state management
   - Offline IndexedDB queuing & synchronization
   - Mobile shell & UI component rendering

---

## X. CODEBASE CLEANLINESS AUDIT

1. **TODO / FIXME / Debug Cleanup:** Checked and verified: 0 TODOs, 0 FIXMEs, and 0 loose `console.log` statements remain in application code.
2. **Accidental Artifacts:**
   - `c:\Zentro_globe\exit`: 1.8 KB git log dump.
   - `backend/db.sqlite3.bak`: 503 KB database backup.
   - `backend/db.sqlite3.pre-payment-qr.bak`: 1.88 MB database backup.
   - `c:\Zentro_globe\test_register.py`: 508-byte scratch file.

---

## Y. MONITORING & OBSERVABILITY AUDIT

1. **Production Frontend Error Dropping:** `src/lib/lovable-error-reporting.ts` delegates unhandled exceptions to `window.__lovableEvents?.captureException`. In production environments outside the Lovable container, `__lovableEvents` is undefined, causing all frontend exceptions to be silently dropped without reaching an external error monitoring service (e.g. Sentry).
2. **Backend Slow Request Telemetry:** Structured JSON logging in `backend/config/settings.py` (lines 503–534) logs response times, memory, and path parameters, flagging queries exceeding 1 second.

---

## Z. INDIVIDUAL REMEDIATION ISSUE CARDS

### ISSUE-001
- **ID:** ISSUE-001
- **Category:** Functionality / User Flow / Routing
- **Severity:** CRITICAL
- **Priority:** P0
- **Location:** `src/routes/__root.tsx` (lines 30–61)
- **Affected Page/Feature:** Table QR Ordering (`/m/$slug/table/$token`), Guest Storefront (`/guest/merchant/$slug`), Store Directory (`/stores`), Offline Fallback (`/offline`)
- **Problem:** `PUBLIC_ROUTES` is limited to auth pages. Any unauthenticated customer visiting a public page or scanning a table QR code is intercepted by `AuthGate` and redirected to `/auth`.
- **Expected Behavior:** Diners scanning a table QR code should immediately view the menu and place a guest order without being forced to create an account or log in.
- **Actual Behavior:** The browser immediately redirects guests to `/auth?redirect=/m/...`.
- **Steps to Reproduce:**
  1. Open a browser in incognito mode (no JWT tokens in `localStorage`).
  2. Navigate directly to `http://localhost:8080/m/my-cafe/table/TBL-123` or `http://localhost:8080/stores`.
  3. Observe immediate redirection to `http://localhost:8080/auth`.
- **Evidence:** Lines 30 and 40-60 in `src/routes/__root.tsx`:
  ```ts
  const PUBLIC_ROUTES = ["/auth", "/auth/merchant", "/auth/forgot-password", "/auth/reset-password"];
  ...
  const isPublic = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));
  ...
  if (!user && !isPublic) navigate({ to: "/auth", ... });
  ```
- **Likely Root Cause:** `PUBLIC_ROUTES` was never updated when guest table QR and discovery features were introduced.
- **User Impact:** No customer can use table QR code ordering or public store pages without an existing registered account.
- **Production Impact:** Complete breakdown of the primary in-restaurant guest ordering funnel.
- **Recommended Fix Direction:** Add `"/m"`, `"/guest"`, `"/stores"`, `"/table"`, and `"/offline"` to the `PUBLIC_ROUTES` list in `src/routes/__root.tsx`.

---

### ISSUE-002
- **ID:** ISSUE-002
- **Category:** API / Authorization / Error Handling
- **Severity:** CRITICAL
- **Priority:** P0
- **Location:** `backend/orders/views.py` (lines 977–998) & `src/routes/orders.$id.tsx` (lines 10–15)
- **Affected Page/Feature:** Order Tracking (`/orders/$id`) & Order Detail API (`GET /api/orders/<id>/`)
- **Problem:** Guest orders have `order.customer = None`. The order detail API enforces `IsAuthenticated` and checks `order.customer == request.user.customer_profile`, returning `401` or `403`. Frontend route also specifies `beforeLoad: requireAuth`.
- **Expected Behavior:** Guests placing a table order should be able to track order progress (brewing, ready, completed) using a secure token or order UUID.
- **Actual Behavior:** Guest receives a 401 Unauthorized or 403 Forbidden when requesting order details.
- **Steps to Reproduce:**
  1. Place an order via `POST /api/orders/guest-create/`.
  2. Attempt to fetch the created order via `GET /api/orders/<id>/` without an `Authorization` header.
  3. Observe HTTP 401 status.
- **Evidence:** `backend/orders/views.py` (lines 977–998):
  ```python
  @api_view(["GET"])
  @permission_classes([IsAuthenticated])
  def order_detail(request, pk):
      ...
      is_owner = (hasattr(user, "customer_profile") and order.customer == user.customer_profile) ...
      if not is_owner and not user.is_staff:
          return Response({"error": "Not authorised."}, status=status.HTTP_403_FORBIDDEN)
  ```
- **Likely Root Cause:** The order detail view was built assuming all orders belong to authenticated customer accounts.
- **User Impact:** Diners who submit table orders are left on a broken screen without confirmation or pickup notifications.
- **Production Impact:** Customer confusion, duplicate orders placed, and high staff friction.
- **Recommended Fix Direction:** Provide a tokenized or UUID-based public lookup endpoint (e.g. `GET /api/orders/public/<uuid:order_uuid>/`), and remove `requireAuth` from `orders.$id.tsx` when a guest order token is present.

---

### ISSUE-003
- **ID:** ISSUE-003
- **Category:** Business Logic / POS / Billing
- **Severity:** HIGH
- **Priority:** P1
- **Location:** `backend/pos/views.py` (lines 1939–1953)
- **Affected Page/Feature:** POS Order Payment (`POST /api/pos/payment/create/`)
- **Problem:** Orders stall in `status="confirmed"` and `payment_status="partially_paid"` when payments are processed without accounting for tax calculations.
- **Expected Behavior:** Tendering full payment should mark the order as `status="completed"`, `payment_status="paid"`, and award loyalty points.
- **Actual Behavior:** `total_paid < order.total_amount` leaves the order in `confirmed` status. Verified in QA test suite `test_43_pos_order_and_payment`.
- **Steps to Reproduce:**
  1. Run `python manage.py test qa_test.POSFlowTests.test_43_pos_order_and_payment`.
  2. Observe `AssertionError: 'confirmed' != 'completed'`.
- **Evidence:** Lines 1939-1953 in `backend/pos/views.py`:
  ```python
  if total_paid >= order.total_amount:
      order.payment_status = "paid"
      order.status = Order.STATUS_COMPLETED
  elif total_paid > 0:
      order.payment_status = "partially_paid"
  ```
- **Likely Root Cause:** `tax_enabled` defaults to `True` on `MerchantProfile`, calculating a total of 452.00 on a 400.00 subtotal order, causing a 400.00 cash payment to be treated as a partial payment.
- **User Impact:** Cashiers must take extra manual steps to close tickets, and customer loyalty points are withheld.
- **Production Impact:** Orders remain incomplete in the KDS and daily reconciliations show open balances.
- **Recommended Fix Direction:** Ensure POS payment interfaces always tender against the authoritative server-calculated `grand_total` (inclusive of taxes and service charges).

---

### ISSUE-004
- **ID:** ISSUE-004
- **Category:** Performance / Assets
- **Severity:** HIGH
- **Priority:** P1
- **Location:** `public/favicon.png`
- **Affected Page/Feature:** Core Application Initial Load / FCP & LCP
- **Problem:** `public/favicon.png` is **2,171,194 bytes** (2.17 MB).
- **Expected Behavior:** Favicon assets should be small rasters under 10 KB.
- **Actual Behavior:** A 2.17 MB uncompressed high-resolution image is loaded by browsers and web manifest handlers.
- **Steps to Reproduce:** Check `dir public/favicon.png` in terminal (size: 2,171,194 bytes).
- **Evidence:** File size inspection confirms 2.17 MB on disk.
- **Likely Root Cause:** Full-resolution design source export was placed directly into the `public/` directory without optimization.
- **User Impact:** Sluggish initial page loads, high mobile data usage, poor Lighthouse performance scores.
- **Production Impact:** Unnecessary server bandwidth consumption; degraded Core Web Vitals.
- **Recommended Fix Direction:** Resize and compress `favicon.png` to standard 32x32 and 192x192 PNG sizes (<15 KB).

---

### ISSUE-005
- **ID:** ISSUE-005
- **Category:** SEO / Crawlability
- **Severity:** HIGH
- **Priority:** P1
- **Location:** `src/routes/index.tsx` (lines 61–70), `public/`
- **Affected Page/Feature:** Root Domain Landing Page & Search Engine Crawlability
- **Problem:** The root URL `/` requires authentication (`beforeLoad: requireAuth`). No `robots.txt`, `sitemap.xml`, or canonical links exist.
- **Expected Behavior:** Public search crawlers should be able to index landing content, cafe listings, and metadata.
- **Actual Behavior:** Crawlers hitting `/` are bounced to `/auth`. The site cannot be indexed by Google or Bing.
- **Steps to Reproduce:**
  1. Inspect `public/robots.txt` and `public/sitemap.xml` (both missing).
  2. Make an unauthenticated HTTP GET request to `/` and observe redirect to `/auth`.
- **Evidence:** `src/routes/index.tsx` (lines 61–62):
  ```tsx
  export const Route = createFileRoute("/")({
    beforeLoad: requireAuth,
  ```
- **Likely Root Cause:** The app was built purely as a private dashboard, omitting public landing and crawl infrastructure.
- **User Impact:** Potential customers cannot discover Zentro or its partner cafes via organic web searches.
- **Production Impact:** Zero organic search visibility.
- **Recommended Fix Direction:** Provide a public landing or store directory view at `/` when unauthenticated, generate a `robots.txt` and `sitemap.xml`, and add canonical URL link tags.

---

### ISSUE-006
- **ID:** ISSUE-006
- **Category:** Security / Session Handling
- **Severity:** HIGH
- **Priority:** P1
- **Location:** `src/lib/django-api-base.ts` (lines 29–40)
- **Affected Page/Feature:** JWT Authentication Token Storage
- **Problem:** Both JWT access (`dja`) and 30-day refresh (`djr`) tokens are stored in browser `localStorage`.
- **Expected Behavior:** Long-lived refresh tokens should be stored in secure, `HttpOnly`, `SameSite=Lax` cookies inaccessible to JavaScript.
- **Actual Behavior:** Tokens are accessible to any JavaScript running within the application context.
- **Steps to Reproduce:** Run `localStorage.getItem("djr")` in the browser console while logged in to view the token.
- **Evidence:** Lines 30-35 in `src/lib/django-api-base.ts`:
  ```ts
  export const tokenStore = {
    getAccess: (): string | null => localStorage.getItem("dja"),
    getRefresh: (): string | null => localStorage.getItem("djr"),
  ```
- **Likely Root Cause:** Convenience implementation for SPA client-side token management.
- **User Impact:** If an XSS vulnerability occurs or a third-party script is compromised, user sessions can be hijacked for up to 30 days.
- **Production Impact:** Security audit vulnerability; increased blast radius of any XSS flaw.
- **Recommended Fix Direction:** Migrate refresh token storage to `HttpOnly` secure cookies via Django REST Framework SimpleJWT cookie settings.

---

### ISSUE-007
- **ID:** ISSUE-007
- **Category:** Database / Concurrency / Idempotency
- **Severity:** HIGH
- **Priority:** P1
- **Location:** `backend/orders/models.py` (lines 355–361)
- **Affected Page/Feature:** Order Idempotency Constraint (`uniq_customer_merchant_mutation`)
- **Problem:** The unique constraint on `(customer, merchant, client_mutation_id)` fails to enforce uniqueness when `customer` is `NULL` (as is the case for all guest table orders and walk-in POS orders).
- **Expected Behavior:** Duplicate submissions with the same `client_mutation_id` must be rejected regardless of whether `customer` is null.
- **Actual Behavior:** SQL treats null values as distinct, allowing duplicate orders with identical mutation IDs to be saved.
- **Steps to Reproduce:** Submit two guest orders with `customer=None`, `merchant=1`, and the same `client_mutation_id`. Both succeed without database integrity errors.
- **Evidence:** Line 356 in `backend/orders/models.py`:
  ```python
  models.UniqueConstraint(
      fields=["customer", "merchant", "client_mutation_id"],
      condition=~models.Q(client_mutation_id__isnull=True),
      name="uniq_customer_merchant_mutation",
  )
  ```
- **Likely Root Cause:** PostgreSQL and SQLite standard SQL behavior for multi-column unique constraints with nullable fields.
- **User Impact:** Network retries on mobile connections can cause diners or cashiers to be charged twice for duplicate orders.
- **Production Impact:** Order duplication, inventory double-deduction, and financial reconciliation discrepancies.
- **Recommended Fix Direction:** Use a separate idempotency model (like `ProcessedClientMutation` in POS) or create a coalesce-based functional index for guest order mutation IDs.

---

### ISSUE-008
- **ID:** ISSUE-008
- **Category:** Code Quality / Developer Experience
- **Severity:** MEDIUM
- **Priority:** P2
- **Location:** `.prettierrc`
- **Affected Page/Feature:** Code Quality & Linting (`npm run lint` / ESLint)
- **Problem:** Running `eslint .` on Windows generates hundreds of thousands of `Delete ␍ prettier/prettier` errors across all files.
- **Expected Behavior:** `npm run lint` should run cleanly across Windows, Linux, and macOS environments.
- **Actual Behavior:** Linting fails immediately with 560+ errors per file due to CRLF/LF line ending mismatches.
- **Steps to Reproduce:** Run `npx eslint src/lib/auth.tsx` on Windows and observe 563 prettier line ending errors.
- **Evidence:** Terminal output: `error Delete ␍ prettier/prettier`.
- **Likely Root Cause:** `.prettierrc` lacks `"endOfLine": "auto"`.
- **User Impact:** Developers on Windows cannot run or pass pre-commit hooks or automated lint checks.
- **Production Impact:** CI/CD lint pipelines fail when code is committed from Windows environments.
- **Recommended Fix Direction:** Add `"endOfLine": "auto"` to `.prettierrc`.

---

### ISSUE-009
- **ID:** ISSUE-009
- **Category:** Code Quality / React Architecture
- **Severity:** MEDIUM
- **Priority:** P2
- **Location:** `src/routes/__root.tsx` (lines 173–175)
- **Affected Page/Feature:** Router Context Injection
- **Problem:** `router.options.context` is mutated inside a `useMemo` hook.
- **Expected Behavior:** Context updates should be handled via pure hooks or within `useEffect`.
- **Actual Behavior:** Side effect executes during render calculation.
- **Evidence:** Line 173 in `src/routes/__root.tsx`:
  ```tsx
  useMemo(() => {
    router.options.context = { ...router.options.context, auth };
  }, [auth, router]);
  ```
- **Likely Root Cause:** Attempting to synchronize router context with React state before the next render.
- **User Impact:** Potential stale auth state during rapid client-side navigations under React 19 concurrent mode.
- **Production Impact:** Difficult-to-reproduce client-side routing glitches.
- **Recommended Fix Direction:** Replace `useMemo` with `useEffect`.

---

### ISSUE-010
- **ID:** ISSUE-010
- **Category:** Routing / Dead Code
- **Severity:** MEDIUM
- **Priority:** P2
- **Location:** `src/routes/stores_.$id.tsx`
- **Affected Page/Feature:** Store Detail Route (`/stores_/$id`)
- **Problem:** The route file has a typo (`stores_.$id.tsx`), generating the URL path `/stores_/:id`. All real application navigation links point to `/m/:slug`.
- **Expected Behavior:** Consistent naming conventions; dead routes should not exist in the routing tree.
- **Actual Behavior:** An unlinked route occupies space in `routeTree.gen.ts`.
- **Evidence:** `src/features/store-locator/pages/StoresPage.tsx` (line 263) calls `navigate({ to: "/m/$slug", params: { slug } })`, never referencing `/stores_/$id`.
- **Likely Root Cause:** Abandoned experiment during the TanStack Router migration.
- **User Impact:** None (route is unlinked).
- **Production Impact:** Confusion during code maintenance; bundle bloat.
- **Recommended Fix Direction:** Remove `src/routes/stores_.$id.tsx`.

---

### ISSUE-011
- **ID:** ISSUE-011
- **Category:** Code Duplication / Maintainability
- **Severity:** MEDIUM
- **Priority:** P2
- **Location:** `src/routes/leaderboard.tsx`
- **Affected Page/Feature:** Leaderboard Page
- **Problem:** Contains a complete duplicate implementation of `src/features/loyalty-engine/pages/LeaderboardPage.tsx` (223 identical lines).
- **Expected Behavior:** Route files should import and render feature page components.
- **Actual Behavior:** Identical logic is copied and pasted in two separate files.
- **Evidence:** Direct side-by-side comparison of `src/routes/leaderboard.tsx` and `src/features/loyalty-engine/pages/LeaderboardPage.tsx`.
- **Likely Root Cause:** Copying code into the route file instead of importing the existing page component.
- **User Impact:** Inconsistent behavior if one copy is edited and the other is missed.
- **Production Impact:** Technical debt and increased maintenance overhead.
- **Recommended Fix Direction:** Refactor `src/routes/leaderboard.tsx` to simply import and render `<LeaderboardPage />`.

---

### ISSUE-012
- **ID:** ISSUE-012
- **Category:** Monitoring / Error Tracking
- **Severity:** MEDIUM
- **Priority:** P2
- **Location:** `src/lib/lovable-error-reporting.ts` (lines 21–36)
- **Affected Page/Feature:** Client-Side Error Reporting
- **Problem:** Production errors rely on `window.__lovableEvents?.captureException`. When hosted on self-managed infrastructure (e.g. Docker, VPS, Vercel), this object does not exist and all frontend exceptions are lost.
- **Expected Behavior:** Unhandled runtime exceptions should be captured by an external telemetry service (e.g. Sentry, Datadog).
- **Actual Behavior:** Errors are silently logged to the client console only.
- **Evidence:** Lines 22-24 in `src/lib/lovable-error-reporting.ts`:
  ```ts
  export function reportLovableError(...) {
    if (typeof window === "undefined") return;
    window.__lovableEvents?.captureException?.(...)
  ```
- **Likely Root Cause:** Scaffolded code from the Lovable prototyping platform.
- **User Impact:** Bugs affecting end-users remain invisible to the engineering team.
- **Production Impact:** Inability to proactively diagnose and fix production crashes.
- **Recommended Fix Direction:** Integrate Sentry or an equivalent error reporting SDK.

---

### ISSUE-013
- **ID:** ISSUE-013
- **Category:** Codebase Cleanliness / Privacy
- **Severity:** LOW
- **Priority:** P3
- **Location:** `c:\Zentro_globe\exit`, `backend/db.sqlite3.bak`, `c:\Zentro_globe\test_register.py`
- **Affected Page/Feature:** Workspace Cleanliness & Git Working Tree
- **Problem:** Unused scratch scripts, terminal output logs, and binary database backup files are present in the repository.
- **Expected Behavior:** Workspaces should only contain source code, tests, documentation, and configuration.
- **Actual Behavior:** 2.3+ MB of database backups and temporary test scripts remain on disk.
- **Evidence:** File listings of `exit`, `db.sqlite3.bak`, and `test_register.py`.
- **Likely Root Cause:** Developer debugging artifacts left uncleaned.
- **User Impact:** None directly.
- **Production Impact:** Bloats repository clone size; risk of committing sensitive test data.
- **Recommended Fix Direction:** Add `*.bak`, `*.sql`, and temporary test scripts to `.gitignore` and remove the existing artifacts.

---

### ISSUE-014
- **ID:** ISSUE-014
- **Category:** Accessibility (a11y)
- **Severity:** LOW
- **Priority:** P3
- **Location:** `src/routes/__root.tsx`
- **Affected Page/Feature:** Skip Navigation
- **Problem:** The root HTML shell lacks a skip navigation link (`Skip to main content`).
- **Expected Behavior:** Keyboard and assistive tech users should be able to bypass topbars and jump directly to the page content.
- **Actual Behavior:** Users must tab through topbar icons and header links on every page transition.
- **Evidence:** Inspection of `src/routes/__root.tsx` lines 300-340 confirms absence of skip links.
- **Likely Root Cause:** Mobile-first design oversight.
- **User Impact:** Suboptimal keyboard navigation experience for users relying on screen readers or switch devices.
- **Production Impact:** Fails WCAG 2.1 Success Criterion 2.4.1 (Bypass Blocks).
- **Recommended Fix Direction:** Add a visually hidden `<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to content</a>` link in `__root.tsx`.

---

### ISSUE-015
- **ID:** ISSUE-015
- **Category:** Dependencies / Compliance
- **Severity:** INFORMATIONAL
- **Priority:** P3
- **Location:** `backend/requirements.txt` (line 18)
- **Affected Page/Feature:** PyMuPDF License (`pymupdf>=1.24`)
- **Problem:** PyMuPDF is licensed under GNU AGPLv3. If Zentro is distributed or hosted as a proprietary network service, AGPLv3 compliance requires careful consideration.
- **Expected Behavior:** Open-source dependencies should align with the project's intellectual property and distribution goals.
- **Actual Behavior:** AGPLv3 library is used for rendering PDF inventory reports.
- **Likely Root Cause:** Chosen for high-quality PDF rendering performance.
- **Production Impact:** Commercial licensing considerations if proprietary exclusivity is required.
- **Recommended Fix Direction:** Review legal requirements or obtain a commercial PyMuPDF license, or evaluate ReportLab / WeasyPrint as alternative permissive options.

---

## FINAL PRIORITIZED ISSUE TABLE

| ID | Severity | Category | Page/Feature | Issue | User Impact | Production Impact |
|---|---|---|---|---|---|---|
| **ISSUE-001** | **CRITICAL** | Routing / Auth | Table QR & Storefront | `AuthGate` intercepts and blocks guest diners; redirects to `/auth` | Guests cannot scan QR code and order food without logging in | Primary in-restaurant order funnel completely non-functional |
| **ISSUE-002** | **CRITICAL** | API / Auth | Order Detail / Tracking | Guest orders have `customer=None`; `GET /api/orders/<id>/` returns 401/403 | Diners cannot track order preparation or pickup status | Severe customer confusion; duplicate orders placed |
| **ISSUE-003** | **HIGH** | Business Logic | POS Payment | Orders stall in `confirmed` and `partially_paid` when tax calculation exceeds tender | Cashiers cannot close tickets; loyalty points withheld | Open tickets accumulate; daily cash reconciliations mismatch |
| **ISSUE-004** | **HIGH** | Performance | Asset Loading | `public/favicon.png` is **2.17 MB** | Slow initial load on mobile networks; high data usage | Poor Core Web Vitals (FCP/LCP); wasted bandwidth |
| **ISSUE-005** | **HIGH** | SEO / Crawling | Root Domain (`/`) | Root URL requires auth; missing `robots.txt` & `sitemap.xml` | Platform and partner cafes cannot be found via web search | Zero organic search indexability |
| **ISSUE-006** | **HIGH** | Security | Auth Storage | Refresh token stored in `localStorage` instead of `HttpOnly` cookie | User accounts vulnerable to 30-day session hijacking via XSS | Elevated risk profile in security audits |
| **ISSUE-007** | **HIGH** | Database | Order Constraints | Idempotency unique constraint fails when `customer` is `NULL` | Network retries can create duplicate guest orders and double-charge | Order and payment duplication |
| **ISSUE-008** | **MEDIUM** | Code Quality | Prettier / Linter | Missing `endOfLine: auto` triggers 560+ CRLF errors per file on Windows | Windows developers cannot run lint checks or pre-commit hooks | CI/CD build failures |
| **ISSUE-009** | **MEDIUM** | Code Quality | Root Component | `useMemo` mutates `router.options.context` | Potential routing state desynchronization in React 19 | Intermittent navigation glitches |
| **ISSUE-010** | **MEDIUM** | Routing | Store Detail | Dead route `stores_.$id.tsx` contains typo in filename | None (unlinked route) | Unnecessary code and bundle bloat |
| **ISSUE-011** | **MEDIUM** | Code Quality | Leaderboard | `routes/leaderboard.tsx` duplicates 223 lines from feature page | Inconsistent UI if one copy is edited and not the other | Technical debt and maintenance overhead |
| **ISSUE-012** | **MEDIUM** | Monitoring | Error Telemetry | Frontend errors delegate to undefined `window.__lovableEvents` | Production UI crashes go undetected by developers | Inability to proactively resolve frontend bugs |
| **ISSUE-013** | **LOW** | Cleanliness | Workspace Root | Binary `.bak` databases, scratch test scripts, and log dumps in repo | None directly | Cluttered repo; risk of committing test credentials |
| **ISSUE-014** | **LOW** | Accessibility | Shell Navigation | Root template lacks "Skip to main content" link | Keyboard/screen reader users must tab through all nav links | Fails WCAG 2.1 AA bypass criteria |
| **ISSUE-015** | **INFORMATIONAL** | Compliance | Backend PDF | PyMuPDF uses GNU AGPLv3 copyleft license | None directly | Requires commercial license for closed-source compliance |

---

## PASS / FAIL SUMMARY

| Domain | Status | Key Evaluation Summary |
|---|---|---|
| **FUNCTIONALITY** | **PARTIAL** | Core merchant, POS, inventory, and member flows pass; Guest table QR flow fails due to root auth gating. |
| **UI/UX** | **PARTIAL** | Sleek mobile aesthetic and modern design tokens; desktop view suffers from narrow phone column lock. |
| **RESPONSIVENESS** | **PARTIAL** | Mobile responsive layouts work well; tablet and small mobile (<360px) experience nav tap overcrowding. |
| **ACCESSIBILITY** | **PARTIAL** | Semantic tags present in many areas; lacks skip navigation links and some icon buttons lack labels. |
| **SECURITY** | **PARTIAL** | Excellent file upload sanitization and ORM SQL protection; tokens stored in `localStorage` rather than `HttpOnly` cookies. |
| **PERFORMANCE** | **PARTIAL** | Fast client bundle compilation (~4s); dragged down by 2.17 MB favicon and uncompressed public rasters. |
| **SEO** | **FAIL** | Root URL redirects crawlers to `/auth`; missing `robots.txt`, `sitemap.xml`, canonical tags, and Open Graph images. |
| **BACKEND** | **PASS** | Solid DRF architecture, structured middleware logging, transaction isolation, and Django Unfold admin. |
| **DATABASE** | **PARTIAL** | Migrations clean and applied; nullable unique constraint allows duplicate guest mutations. |
| **API** | **PARTIAL** | 31/33 test suite endpoints pass; guest order detail lookup is missing and returns 401/403. |
| **AUTHENTICATION** | **PASS** | Role isolation, SimpleJWT blacklist rotation, password hashing, and phone OTP verification verified. |
| **BUSINESS LOGIC** | **PARTIAL** | Deterministic pricing engine verified; POS payment completion logic stalls under default tax conditions. |
| **DEPLOYMENT** | **PASS** | Multi-stage Dockerfiles for backend and frontend with Docker Compose orchestration configured. |
| **CODE QUALITY** | **PARTIAL** | Strict TypeScript compiles with 0 errors; zero TODOs; Windows prettier CRLF line-ending configuration missing. |
