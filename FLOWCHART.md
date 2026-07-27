# Zentro Glow Loyalty - Complete System Flowchart

## Table of Contents
1. [System Architecture Overview](#1-system-architecture-overview)
2. [Authentication & User Roles](#2-authentication--user-roles)
3. [Merchant Onboarding Flow](#3-merchant-onboarding-flow)
4. [Customer Journey](#4-customer-journey)
5. [Customer App - Ordering Flow](#5-customer-app---ordering-flow)
6. [Guest Ordering Flow](#6-guest-ordering-flow)
7. [POS System - Complete Flow](#7-pos-system---complete-flow)
8. [Loyalty System - Complete Flow](#8-loyalty-system---complete-flow)
9. [Order Lifecycle (All Sources)](#9-order-lifecycle-all-sources)
10. [Payment Processing](#10-payment-processing)
11. [Shift Management & Cash Reconciliation](#11-shift-management--cash-reconciliation)
12. [Staff Management & Scheduling](#12-staff-management--scheduling)
13. [Merchant Admin Dashboard](#13-merchant-admin-dashboard)
14. [Table QR Ordering Flow](#14-table-qr-ordering-flow)
15. [Point Transfer (Peer-to-Peer)](#15-point-transfer-peer-to-peer)
16. [Today's Specials](#16-todays-specials)
17. [Membership Card Design & QR Tokens](#17-membership-card-design--qr-tokens)
18. [Offline Sync & Conflict Resolution](#18-offline-sync--conflict-resolution)
19. [Notification System](#19-notification-system)
20. [PWA & Real-Time Features](#20-pwa--real-time-features)
21. [Data Model Relationships](#21-data-model-relationships)
22. [API Endpoint Map](#22-api-endpoint-map)

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ZENTRO GLOW LOYALTY                            │
│                        Full-Stack Loyalty POS System                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │  CUSTOMER    │  │  MERCHANT    │  │  POS         │                   │
│  │  MOBILE APP  │  │  ADMIN WEB   │  │  TERMINAL    │                   │
│  │  (React/PWA) │  │  (React)     │  │  (React)     │                   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                   │
│         │                  │                  │                         │
│         └──────────────────┼──────────────────┘                         │
│                            │                                            │
│                   ┌────────▼────────┐                                   │
│                   │  REST API       │                                   │
│                   │  (Django DRF)   │                                   │
│                   ├─────────────────┤                                   │
│                   │ PostgreSQL DB   │                                   │
│                   │                 │                                   │
│                   └─────────────────┘                                   │
│                                                                         │
│  40 Django Models │ 157+ API Endpoints │ 47 Frontend Routes             │
│  6 Django Apps    │ JWT Auth + Device  │ Zustand + React Query          │
│                   │ WebSocket (Django Channels) │ TanStack Router       │
└─────────────────────────────────────────────────────────────────────────┘

Tech Stack:
- Frontend: React 19, TanStack Router/Start (file-based), Zustand, TanStack Query, Tailwind CSS
- Backend: Django 6, DRF, SimpleJWT, PostgreSQL, Django Channels (WebSocket)
- Auth: JWT (customer + merchant), Device-Token (POS)
- PWA: Service Worker, Install Prompt, Offline Fallback
- Currency: Nepalese Rupees (NPR)
```

### Django Apps
```
backend/
├── accounts/       → User, CustomerProfile, PasswordResetToken
├── merchants/      → MerchantProfile, MenuItem, MerchantTable
├── loyalty/        → Wallets, Points, Punch Cards, Missions, Rewards, QR, Card Design, TodaySpecial
├── orders/         → Order, OrderItem
├── notifications/  → Notification
└── pos/            → Devices, Workers, Shifts, Payments, Discounts, Credit/Debit, Schedules, Cash Movements
```

### Frontend Route Structure (47 Routes)
```
src/
├── __root.tsx              → Root layout (providers, auth gate, WebSocket, PWA)
├── index.tsx               → Home Dashboard (loyalty card, quick actions, specials)
├── menu.tsx                → Menu Browser
├── cart.tsx                → Shopping Cart
├── map.tsx                 → Store Discovery Map
├── stores.tsx              → Stores List
├── stores.$id.tsx          → Store Detail
├── loyalty.tsx             → Loyalty Dashboard
├── rewards.tsx             → Rewards Catalog
├── missions.tsx            → Missions Hub
├── leaderboard.tsx         → Leaderboard
├── cards.tsx               → Membership Cards (card stack)
├── cards.$merchantSlug.tsx → Card Detail
├── transfers.tsx           → Point Transfers (Send/Receive/History)
├── notifications.tsx       → Notifications Inbox
├── profile.tsx             → Customer Profile
├── offline.tsx             → PWA Offline Fallback
├── customer.merchants.tsx  → Joined Merchants
├── customer.order.tsx      → Single Order Detail
├── customer.orders.tsx     → Order History
├── customer.merchant.$slug.tsx → Merchant Storefront
├── guest.merchant.$slug.tsx    → Guest Ordering (no auth)
├── loyalty.qr.$token.tsx       → Membership QR Resolver
├── table.$token.order.tsx      → Table QR Order
├── m.$slug.tsx                  → Smart Entry Point (role-based redirect)
├── m.$slug.table.$token.tsx    → Table via Merchant Slug
├── auth.*                      → Auth routes (login, signup, forgot/reset password)
├── merchant.*                  → Merchant dashboard (orders, menu, tables, loyalty, specials, analytics, store, onboarding)
└── pos.*                       → POS terminal (orders, staff, schedule, reports, z-report, settings, accounts, cash-movements, conflicts)
```

---

## 2. Authentication & User Roles

### 2.1 User Types
```
                    ┌──────────┐
                    │   User   │
                    │ (roles:) │
                    └────┬─────┘
                         │
              ┌──────────┴──────────┐
              │                     │
        ┌─────▼─────┐       ┌──────▼──────┐
        │ CUSTOMER  │       │  MERCHANT   │
        │ (role=    │       │  (role=     │
        │ customer) │       │  merchant)  │
        └─────┬─────┘       └──────┬──────┘
              │                     │
        ┌─────▼──────────┐   ┌─────▼───────────┐
        │CustomerProfile │   │MerchantProfile  │
        │ (OneToOne)     │   │ (OneToOne)      │
        │ • loyalty_pts  │   │ • business_name │
        │ • streak_days  │   │ • slug (unique) │
        │ • tier         │   │ • pos_enabled   │
        │ • transfer_code│   │ • is_approved   │
        └────────────────┘   │ • 30+ settings  │
                              └─────────────────┘
```

### 2.2 Authentication Flows

#### Customer Auth
```
/auth/signup → POST /auth/register/ {email, password, full_name, role:"customer"}
     ↓
  JWT Tokens (access + refresh) stored in localStorage
     ↓
  Auto-refresh 2 min before expiry via POST /auth/token/refresh/
     ↓
  useAuth() hook provides: user, merchantProfile, signIn, signUp, signOut
     ↓
  Auth Guards: requireAuth(), requireCustomer()
```

#### Merchant Auth
```
/auth/merchant/signup → POST /auth/register/ {email, password, full_name, role:"merchant", store_name}
     ↓
  JWT Tokens stored in localStorage
     ↓
  If onboarding_complete=false → Force redirect to /merchant/onboarding
     ↓
  requireMerchant() guard on all /merchant/* routes
```

#### POS Device Auth (Dual Path)
```
┌──────────────────────────────────────────────────────┐
│  PATH 1: Device-Token (Survives Refresh)             │
│  localStorage has pos_device_id + pos_device_token?  │
│    → posDeviceBootstrap() via X-Pos-Device-* headers │
│    → bootstrap(resp) → Done                          │
├──────────────────────────────────────────────────────┤
│  PATH 2: JWT Fallback                                │
│  Device-token failed? → posBootstrap() with JWT      │
│    → bootstrap(resp) → Done                          │
├──────────────────────────────────────────────────────┤
│  PATH 3: New Device                                  │
│  No device? → posAuthorizeDevice() → register new    │
│    → Store device_id + device_token in localStorage  │
│    → posBootstrap() → Done                           │
└──────────────────────────────────────────────────────┘
```

---

## 3. Merchant Onboarding Flow

```
POST /auth/register/ (role: merchant)
     │
     ▼
/auto-redirect to /merchant/onboarding (if onboarding_complete=false)
     │
     ▼
┌──────────────────────────────┐
│  ONBOARDING FORM             │
│  • Business Name (min 3)     │
│  • Slug (branded URL:        │
│    /m/{slug})                │
│  • Address (min 10)          │
│  • Phone (min 7)             │
│  • Description (optional)    │
└──────────────┬───────────────┘
               │
               ▼
PATCH /merchants/me/update/ {
  business_name, slug, address,
  phone, description,
  onboarding_complete: true
}
               │
               ▼
Auto-generates:
  • slug (lowercase, unique)
  • QR code (SVG data URL)
               │
               ▼
Redirect to /merchant/ (dashboard)
```

### Post-Onboarding Setup Flow
```
/merchant/store → Configure:
  ├── Upload Logo + Banner (WebP optimized)
  ├── Set Theme Color (8 presets + custom)
  ├── Generate/Download QR Code
  ├── Set Map Coordinates (lat/lng)
  ├── Design Membership Card
  │   ├── Colors (primary, secondary, accent)
  │   ├── Background (solid/image/pattern)
  │   ├── Labels (title, subtitle, points_label)
  │   ├── Toggles (lifetime points, joined date)
  │   └── Publish → is_published = true
  └── Enable Features:
      ├── Table Ordering
      ├── POS System
      ├── Credit Accounts
      ├── Debit Accounts
      ├── Discounts
      ├── Shift Management
      └── Receipt Printing
```

---

## 4. Customer Journey

### 4.1 New Customer Discovery
```
┌─────────────────────────────────────────────────────────────┐
│  ENTRY POINTS                                               │
│                                                              │
│  1. Direct URL: /auth/signup                                │
│  2. Merchant QR: /m/{slug} → Landing Page → Sign Up         │
│  3. Table QR: /m/{slug}/table/{token} → Table Info → Sign Up│
│  4. Shared Link: /m/{slug} → Landing Page → Sign Up         │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
                POST /auth/register/
                {email, password, full_name, role:"customer"}
                          │
                          ▼
                JWT Tokens → localStorage
                          │
                          ▼
                Redirect to / (Home)
```

### 4.2 Customer Onboarding
```
/auth/login → Redirect to /
     │
     ▼
┌──────────────────────────────────────┐
│  HOME SCREEN (No merchant selected)  │
│  "Select a store to start"           │
│  → Browse Stores: /stores            │
│  → View Map: /map                    │
└────────────┬─────────────────────────┘
             │
             ▼
    ┌─────────────────┐
    │ SELECT MERCHANT │
    │ via:            │
    │ • /stores page  │
    │ • /map page     │
    │ • QR scan       │
    │ • /m/{slug} URL │
    └────────┬────────┘
             │
             ▼
    /customer/merchant/{slug}
             │
             ▼
    Auto-Join: POST /loyalty/merchant-profiles/join/
    Creates:
      • CustomerMerchantProfile (membership_number: CAF-A91K22)
      • CustomerMerchantWallet (0 points, bronze tier)
             │
             ▼
    ┌──────────────────────────────────┐
    │  MERCHANT-SPECIFIC DASHBOARD     │
    │  • Loyalty Card (points, tier)   │
    │  • Quick Actions:                │
    │    ├── Order → Menu              │
    │    ├── Loyalty → Punch Cards     │
    │    ├── Rewards → Redeem Points   │
    │    ├── Leaderboard → Top Users   │
    │    └── Transfer → Send/Receive   │
    └──────────────────────────────────┘
```

---

## 5. Customer App - Ordering Flow

### 5.1 Dine-In Order (Table QR)
```
Customer scans Table QR at cafe
         │
         ▼
/m/{slug}/table/{token}
         │
         ▼
Resolve Table: GET /merchants/public/{slug}/tables/{token}/
         │
         ▼
Set Active Table in Zustand Store:
  { merchantSlug, tableToken, tableId, tableName }
         │
         ▼
Set fulfillment_type = "dine_in"
         │
         ▼
/auto-join merchant if needed
         │
         ▼
Browse Menu (from merchant dashboard home)
  • Category tabs (Coffee, Tea, Food, etc.)
  • Search items
  • Tap item → Add to Cart (quantity 1)
  • +/- quantity controls
         │
         ▼
Go to /cart
  • Items list with quantities
  • Subtotal + SST (6%)
  • "You'll earn X points" badge
  • Notes textarea
         │
         ▼
POST /orders/create/ {
  merchant_id, items: [{menu_item_id, quantity}],
  notes, fulfillment_type: "dine_in",
  table_token: "TBL-xxxxx"
}
         │
         ▼
POST /orders/{id}/update-status/ (merchant confirms)
         │
         ▼
Order Tracking: /orders/{id}
  ┌─────────────────────────────────────────┐
  │  ●────●────●────○────○                   │
  │  Placed Accepted Brewing Ready Picked Up │
  └─────────────────────────────────────────┘
  (Polls every 5 seconds)
         │
         ▼
Merchant marks "completed"
         │
         ▼
_award_loyalty() fires → Points, Streak, Punch Card, Missions
```

### 5.2 Pickup Order
```
Same as Dine-In but:
  • fulfillment_type = "pickup"
  • No table_token required
  • Customer picks up when "Ready"
```

### 5.3 Delivery Order
```
Same as Pickup but:
  • fulfillment_type = "delivery"
  • No table_token required
  • (Delivery tracking not yet implemented)
```

---

## 6. Guest Ordering Flow

### 6.1 Guest Entry Points
```
┌─────────────────────────────────────────────────────────────┐
│  GUEST ENTRY POINTS                                         │
│                                                              │
│  1. Table QR: /m/{slug}/table/{token}                       │
│     → Resolves table → Redirects to guest ordering          │
│                                                              │
│  2. Direct URL: /guest/merchant/{slug}                      │
│     → Guest menu browsing (no auth required)                │
│                                                              │
│  3. Smart Entry: /m/{slug}                                  │
│     → If not logged in → Guest landing page                 │
│     → Shows menu + "Sign up to earn points" CTA            │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
```

### 6.2 Guest Ordering Process
```
┌─────────────────────────────────────────────────────────────┐
│  1. BROWSE MENU (no auth required)                          │
│     GET /merchants/<id>/menu/ (public)                      │
│     → Same menu as logged-in customers                     │
│     → Cart stored in Zustand (persisted to localStorage)   │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  2. CHECKOUT (guest)                                        │
│     POST /orders/guest-create/                              │
│     {                                                       │
│       merchant_id, items, notes,                            │
│       fulfillment_type, table_token,                        │
│       guest_name (optional),                                │
│       guest_session_id (auto-generated UUID)               │
│     }                                                       │
│                                                              │
│     • Creates Order (source=table_qr, status=pending)      │
│     • No loyalty points (no customer linked)               │
│     • Order appears on POS + merchant dashboard            │
│     • Guest can track via session ID                       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  3. POST-ORDER (optional signup)                            │
│     • Guest sees "Sign up to earn points on this order"    │
│     • If signs up → Customer can claim order via POS       │
│     • Merchant can link customer to order:                 │
│       POST /pos/order/assign-customer/                     │
│       → Retroactively awards loyalty points                │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 Smart Entry Point (/m/{slug})
```
/m/{slug} → Smart Router
      │
      ├── Logged in as Customer → /customer/merchant/{slug}
      │   (merchant storefront with loyalty card, menu, actions)
      │
      ├── Logged in as Merchant → /merchant/store
      │   (merchant dashboard)
      │
      └── Not logged in → Guest Landing Page
          (menu preview, "Sign Up" / "Log In" CTAs)
```

---

## 7. POS System - Complete Flow

### 7.0 POS Route Map
```
┌─────────────────────────────────────────────────────────────┐
│  /pos  POS SIDEBAR NAV                                       │
│                                                             │
│  ├── /pos              → Main Order Screen (Menu + Cart)    │
│  ├── /pos/orders       → Order History / Incoming Orders    │
│  ├── /pos/staff        → Worker Management (CRUD + PIN)     │
│  ├── /pos/staff-report → Staff Daily Report                │
│  ├── /pos/schedule     → Staff Schedule (Weekly Calendar)  │
│  ├── /pos/reports      → Reports Hub                       │
│  │   └── /pos/reports/z-report → End-of-Day Z-Report      │
│  ├── /pos/settings     → POS Terminal Configuration        │
│  ├── /pos/accounts     → Debit/Credit Account Management   │
│  ├── /pos/cash-movements → Cash In/Out Tracking            │
│  └── /pos/conflicts    → Sync Conflict Resolution          │
└─────────────────────────────────────────────────────────────┘
```

### 7.1 POS Boot Sequence
```
┌─────────────────────────────────────────────────────────────┐
│  Navigate to /pos                                           │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: DEVICE INITIALIZATION                              │
│  ├── Try device-token bootstrap (survives page refresh)    │
│  ├── Fallback: JWT bootstrap                               │
│  └── Fallback: Register new device                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: WORKER LOGIN (WorkerPinPad)                       │
│  ├── Worker selects name from list                         │
│  ├── Enters 4-digit PIN                                   │
│  ├── Auto-submits on 4th digit                            │
│  ├── Server validates → Worker stored in store + localStorage│
│  └── Locks after 5 failed attempts (15 min)               │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: SHIFT OPEN (if shift_management_enabled)          │
│  ├── Fetch last closed shift closing cash                  │
│  ├── Worker counts cash drawer                             │
│  ├── Enters opening cash (quick buttons: 50, 100, 200, 500)│
│  ├── Warning if ≠ previous shift's closing cash            │
│  └── POST /pos/shift/open/ → CashShift created            │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: MAIN POS LAYOUT                                   │
│  ┌──────────────────────┬──────────────────┐               │
│  │ Incoming Orders      │  Menu Grid       │               │
│  │ (app/table QR)       │  (searchable,    │               │
│  │                      │   categorized)   │               │
│  ├──────────────────────┼──────────────────┤               │
│  │                      │  Cart Panel      │               │
│  │                      │  (items, totals, │               │
│  │                      │   customer link, │               │
│  │                      │   pay button)    │               │
│  └──────────────────────┴──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 POS Ordering Flow
```
┌─────────────────────────────────────────────────────────────┐
│  1. BROWSE MENU                                             │
│  • Category tabs: All, Coffee, Tea, Food, etc.             │
│  • Search bar                                               │
│  • Item cards: image/emoji, name, price, points badge      │
│  • Unavailable items hidden                                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  2. ADD TO CART (tap item)                                  │
│  • Deduplicates by menu_item_id (increments quantity)      │
│  • Cart Panel shows: items, qty controls, subtotal         │
│  • 6% SST applied automatically                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  3. SET ORDER OPTIONS                                       │
│  • Fulfillment type: Dine-in / Takeaway / Delivery         │
│  • Select table (if dine-in)                               │
│  • Link Customer (for loyalty points)                      │
│    └── Search by name, phone, email, membership#          │
│    └── Customer stored in selectedCustomerId               │
│  • Add notes (optional)                                    │
│  • Apply discount (if discounts_enabled)                   │
│    ├── Worker discount limit check                         │
│    └── Manager approval if exceeds threshold               │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  4. PAYMENT (PaymentSheet)                                  │
│  │                                                          │
│  │  Select Method:                                          │
│  │  ┌──────┬──────┬──────┬──────────┬──────┐               │
│  │  │ Cash │ Card │ QR   │ E-Wallet │Debit │               │
│  │  └──────┴──────┴──────┴──────────┴──────┘               │
│  │                                                          │
│  │  Cash: Enter received amount → Change calculated         │
│  │  Card: Enter reference #                                 │
│  │  QR: Enter reference #                                   │
│  │  Wallet: Auto-deduct from debit account                 │
│  │  Debit: Auto-deduct from wallet                         │
│  └─────────────────────┬───────────────────────────────────┘
│                        │
│                        ▼
│  POST /pos/order/create/ {
│    merchant_id, items, customer_id,
│    shift_id, worker_id, device_id,
│    client_mutation_id, fulfillment_type
│  }
│                        │
│                        ▼
│  POST /pos/payment/create/ {
│    order_id (uuid), shift_id,
│    payment_method, amount,
│    change_amount, client_mutation_id
│  }
│                        │
│                        ▼
│  On Payment Complete:
│  ├── Auto-completes Order (status → completed)
│  ├── _award_loyalty() fires (if customer linked)
│  │   ├── Points added to wallet
│  │   ├── Streak updated
│  │   ├── Punch card stamp added
│  │   └── Mission progress updated
│  ├── Cart cleared
│  └── Receipt displayed (thermal print format)
└─────────────────────────────────────────────────────────────┘
```

### 7.3 Incoming Orders (from Customer App / Table QR)
```
┌─────────────────────────────────────────────────────────────┐
│  INCOMING ORDERS PANEL (top of POS order screen)            │
│  Auto-refreshes every 30 seconds                            │
│                                                             │
│  Orders with source = "customer_app" or "table_qr"         │
│  Status = "pending" or "confirmed"                          │
│                                                             │
│  ┌─────────────────────────────────────────────┐           │
│  │ #106  APP ORDER  ⏰ 3m ago  Rs 450.00      │           │
│  │ 2x Latte, 1x Croissant                     │           │
│  │ [Accept] [Reject] [Link Customer]          │           │
│  └─────────────────────────────────────────────┘           │
│                                                             │
│  ACTIONS:                                                   │
│  • pending → Accept (confirmed) / Reject (cancelled)       │
│  • confirmed → Mark Ready (ready)                          │
│  • Link Customer: Search & assign loyalty customer         │
│    → POST /pos/order/assign-customer/                      │
│    → Awards points to linked customer                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Loyalty System - Complete Flow

### 8.1 Points Earning Flow
```
┌─────────────────────────────────────────────────────────────┐
│  TRIGGER: Order status transitions to COMPLETED             │
│                                                             │
│  Sources:                                                   │
│  • Customer App: update_order_status() → _award_loyalty()  │
│  • POS: create_payment() → auto-complete → _award_loyalty()│
│  • Table QR: Same as customer app                           │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  _award_loyalty(order)                                      │
│                                                             │
│  1. Get or Create Wallet                                    │
│     → get_or_create_wallet(customer, merchant)              │
│     → Creates CustomerMerchantProfile if needed            │
│     → Creates CustomerMerchantWallet (bronze, 0 pts)       │
│                                                             │
│  2. Calculate Points (dual system, additive)                │
│     A. Per-item points:                                     │
│        sum(menu_item.points_per_item × quantity)            │
│        (only items where loyalty_reward=True)               │
│     B. Spend-based points (POS only):                      │
│        int(total_amount × loyalty_rules.points_per_npr)    │
│        (default: 1 point per NPR)                          │
│     Total = A + B                                          │
│                                                             │
│  3. Award Points                                            │
│     → award_wallet_points(wallet, points_earned)           │
│     → Updates: points_balance, lifetime_points             │
│     → Creates: PointTransaction (type=EARNED)              │
│     → Recalculates tier (by lifetime_points)              │
│                                                             │
│  4. Update Order Count                                      │
│     → wallet.order_count += 1                               │
│                                                             │
│  5. Update Streak                                           │
│     → update_wallet_streak(wallet)                          │
│     → If 12-36 hours since last order: streak += 1         │
│     → If <12 hours: no change (anti-gaming)                │
│     → If >36 hours: streak reset to 1                     │
│                                                             │
│  6. Punch Card Stamps                                       │
│     → For each active MerchantPunchCard template:          │
│       ├── per_order: always stamp                          │
│       └── per_streak: only if streak incremented           │
│     → add_punch() → if completed: notify                   │
│                                                             │
│  7. Mission Progress                                        │
│     → For each active matching mission:                    │
│       ├── order_count: current_count += 1                  │
│       ├── spend_amount: current_count += total_amount      │
│       └── visit_streak: current_count += 1 (if streak++)  │
│     → If completed: award reward_points as MISSION_BONUS   │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Tier Progression
```
┌─────────────────────────────────────────────────────────────┐
│  TIER THRESHOLDS (based on LIFETIME POINTS, per merchant)  │
│                                                             │
│  ┌─────────┬─────────────────┬──────────────────────┐      │
│  │ Tier    │ Lifetime Points │ Progress Bar         │      │
│  ├─────────┼─────────────────┼──────────────────────┤      │
│  │ Bronze  │ 0 - 499         │ ░░░░░░░░░░ 0%       │      │
│  │ Silver  │ 500 - 1,999     │ ██░░░░░░░░ 10-40%   │      │
│  │ Gold    │ 2,000 - 4,999   │ █████░░░░░ 40-100%  │      │
│  │ Platinum│ 5,000+          │ ██████████ 100%     │      │
│  └─────────┴─────────────────┴──────────────────────┘      │
│                                                             │
│  • Recalculated on every point award                        │
│  • Only upgrades (no downgrade)                             │
│  • Per-merchant (ordering at Store B doesn't affect Store A)│
└─────────────────────────────────────────────────────────────┘
```

### 8.3 Punch Card Flow
```
┌─────────────────────────────────────────────────────────────┐
│  MERCHANT CREATES PUNCH CARD TEMPLATE                       │
│  POST /loyalty/merchant/punch-cards/create/                 │
│  { name, stamps_required: 5, reward_text: "Free Coffee",   │
│    mode: per_order, stamp_icon: "☕" }                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CUSTOMER VIEWS PUNCH CARDS                                 │
│  GET /loyalty/punch-cards/?merchant={id}                   │
│  → Auto-creates CustomerPunchCard for each active template  │
│                                                             │
│  ┌──────┬──────┬──────┬──────┬──────┐                      │
│  │  ☕  │  ☕  │  ☕  │  ☕  │  ?  │  "Free Coffee"       │
│  └──────┴──────┴──────┴──────┴──────┘                      │
│  3 of 5 stamps earned                                       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  EACH COMPLETED ORDER → add_punch()                        │
│  (mode=per_order: always, mode=per_streak: only if streak) │
│                                                             │
│  When current_stamps >= stamps_required:                    │
│  → Card marked as completed                                 │
│  → Customer notified                                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CUSTOMER REDEEMS (shows code to merchant)                  │
│  POST /loyalty/punch-cards/{id}/generate-proof/            │
│  → Returns 6-char proof code (expires 30 minutes)          │
│  → Customer shows code to merchant                          │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
                          
┌─────────────────────────────────────────────────────────────┐
│  MERCHANT CONFIRMS                                          │
│  POST /loyalty/punch-cards/confirm-proof/                   │
│  { proof_code: "A3F2K9" }                                  │
│  → Validates code, marks card as redeemed                  │
│  → Creates Order (type=punch_card_redemption, total=0)     │
│  → Auto-creates new blank card for customer                │
│  → Notifies customer                                       │
└─────────────────────────────────────────────────────────────┘
```

### 8.4 Reward Redemption Flow
```
┌─────────────────────────────────────────────────────────────┐
│  CUSTOMER BROWSES REWARDS                                   │
│  GET /loyalty/rewards/?merchant={id}                       │
│  GET /loyalty/wallets/mine/?merchant={id}                  │
│                                                             │
│  Shows: emoji, name, points cost, stock                    │
│  Locked if insufficient balance                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CUSTOMER REDEEMS                                           │
│  POST /loyalty/rewards/{id}/redeem/                        │
│                                                             │
│  • Validates: active, in stock, enough points              │
│  • Does NOT deduct points yet (held in escrow)             │
│  • Decrements reward stock                                 │
│  • Creates Redemption (status=PENDING, code, 10min expiry) │
│  • Creates Order (type=reward_redemption, total=0)         │
│  • Notifies merchant                                       │
│                                                             │
│  Customer sees: redemption code to show merchant           │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  MERCHANT CONFIRMS CODE                                     │
│  POST /loyalty/redemptions/confirm/                         │
│  { code: "a1b2c3" }                                        │
│  → Validates code, checks expiry                           │
│  → Marks CONFIRMED                                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  MERCHANT COMPLETES ORDER                                   │
│  PATCH /orders/{id}/update-status/ { status: "completed" } │
│  → _deduct_reward_redemption_points()                      │
│  → Actually deducts points from wallet                     │
│  → If merchant cancels: customer keeps points              │
└─────────────────────────────────────────────────────────────┘
```

### 8.5 Missions Flow
```
┌─────────────────────────────────────────────────────────────┐
│  MERCHANT CREATES MISSIONS                                  │
│  POST /loyalty/missions/create/                             │
│  { title: "Coffee Lover", mission_type: "order_count",     │
│    target_count: 10, reward_points: 100 }                  │
│                                                             │
│  Types: order_count, spend_amount, visit_streak             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CUSTOMER VIEWS MISSIONS                                    │
│  GET /loyalty/missions/my-missions/?merchant={id}          │
│                                                             │
│  ┌───────────────────────────────────────────┐             │
│  │ 🎯 Coffee Lover         7/10  ███████░░░ │             │
│  │    Reward: 100 points                     │             │
│  └───────────────────────────────────────────┘             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  EACH COMPLETED ORDER → _update_mission_progress()         │
│                                                             │
│  For each active mission matching the order:               │
│  → Increment current_count                                  │
│  → If current_count >= target_count:                       │
│    ├── is_completed = true                                 │
│    ├── Award reward_points as MISSION_BONUS                │
│    └── Notify customer                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Order Lifecycle (All Sources)

### 9.1 Order Sources
```
┌─────────────────────────────────────────────────────────────┐
│  SOURCE          │ CREATED BY     │ AUTH REQUIRED          │
│  ─────────────────────────────────────────────────────────  │
│  customer_app    │ Customer App   │ Customer JWT           │
│  table_qr        │ Table QR Scan  │ None (public)          │
│  pos_online      │ POS Terminal   │ Device-Token / JWT     │
│  pos_offline     │ POS (offline)  │ Device-Token (queued)  │
│  merchant_dashboard│ Merchant Admin│ Merchant JWT (unused)  │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 Order Status Machine
```
                    ┌──────────┐
                    │ pending  │ (initial status)
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          │          │
        ┌──────────┐     │          │
        │confirmed │     │          │
        └────┬─────┘     │          │
             │           │          │
     ┌───────┤           │          │
     │       │           │          │
     ▼       │           │          │
┌──────────┐ │           │          │
│preparing │ │           │          │
└────┬─────┘ │           │          │
     │       │           │          │
     ▼       │           │          │
┌──────────┐ │           │          │
│  ready   │◄┘           │          │
└────┬─────┘             │          │
     │                   │          │
     ▼                   │          │
┌──────────┐             │          │
│completed │             │          │
└──────────┘             │          │
                         │          │
                    ┌────▼─────┐    │
                    │cancelled │◄───┘
                    └──────────┘
                    (from pending or confirmed)

Valid Transitions:
  pending     → confirmed, cancelled
  confirmed   → preparing, ready, cancelled
  preparing   → ready, cancelled
  ready       → completed, cancelled
  completed   → (terminal - can be refunded)
  cancelled   → (terminal)
```

### 9.3 Order Creation by Source
```
┌─────────────────────────────────────────────────────────────┐
│  CUSTOMER APP ORDER                                         │
│  POST /orders/create/                                       │
│  { merchant_id, items, notes, fulfillment_type,             │
│    table_token }                                            │
│  → Server calculates subtotal from MenuItem prices         │
│  → Server calculates points_earned from items              │
│  → Creates Order + OrderItems                               │
│  → Notifies merchant via Notification                      │
│  → Order starts as "pending"                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  TABLE QR ORDER                                             │
│  POST /pos/table/{token}/order/                             │
│  { items, notes, customer_name }                            │
│  → Public endpoint (no auth)                                │
│  → Resolves table from token                               │
│  → Creates Order (source=table_qr, status=pending)         │
│  → Notifies POS terminal                                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  POS ORDER                                                  │
│  POST /pos/order/create/                                    │
│  { merchant_id, items, customer_id, shift_id, worker_id,   │
│    device_id, fulfillment_type, client_mutation_id }        │
│  → Server validates: POS enabled, shift active, items exist│
│  → Server calculates prices from MenuItem (never trust client)│
│  → Calculates points_earned from items + spend-based       │
│  → Creates Order + OrderItems                               │
│  → If customer_id: joins customer to merchant              │
│  → Idempotent via client_mutation_id                       │
│  → Order status = "completed" (POS auto-completes on pay) │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Payment Processing

### 10.1 POS Payment Flow
```
┌─────────────────────────────────────────────────────────────┐
│  PAYMENT METHODS                                            │
│                                                             │
│  ┌──────────┬────────────────────────────────────────────┐ │
│  │ Method   │ Behavior                                   │ │
│  ├──────────┼────────────────────────────────────────────┤ │
│  │ Cash     │ Enter received → change calculated          │ │
│  │ Card     │ Enter reference # (transaction id)          │ │
│  │ Bank QR  │ Enter reference #                           │ │
│  │ E-Wallet │ Enter reference #                           │ │
│  │ Debit    │ Auto-deduct from DebitAccount (wallet)     │ │
│  │ Credit   │ Add to CreditAccount balance (buy now pay  │ │
│  │          │ later)                                      │ │
│  │ Split    │ Multiple methods for one order              │ │
│  └──────────┴────────────────────────────────────────────┘ │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  1. POST /pos/payment/create/                               │
│  { order_id, shift_id, worker_id, device_id,               │
│    payment_method, amount, change_amount,                   │
│    external_reference, client_mutation_id }                 │
│                                                             │
│  2. Validates:                                              │
│     • Shift is open                                         │
│     • Digital payments require external_reference          │
│     • Cash: amount >= order total                          │
│                                                             │
│  3. Creates PosPayment record                              │
│                                                             │
│  4. If order fully paid → auto-completes order             │
│     → Triggers _award_loyalty()                            │
│                                                             │
│  5. Updates CashShift totals:                              │
│     • total_sales += amount                                │
│     • total_cash_sales / total_card_sales / total_other   │
│     • total_orders += 1                                    │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 Discount Flow
```
┌─────────────────────────────────────────────────────────────┐
│  POST /pos/discount/apply/                                  │
│  { order_id, discount_type, discount_value, reason,        │
│    authorized_by_worker_id }                                │
│                                                             │
│  Validation:                                                │
│  1. Worker must have can_apply_discount permission         │
│  2. If max_worker_discount_percent set:                    │
│     → Percentage exceeding → warning (not blocking)        │
│  3. If exceeds manager_approval_threshold:                 │
│     → Requires manager PIN verification                    │
│     → Manager's can_apply_discount checked                 │
│  4. discount_amount calculated:                            │
│     • percentage: order.subtotal × (value / 100)          │
│     • fixed: value (capped at subtotal)                   │
│                                                             │
│  Applied to Order:                                          │
│  • discount_type, discount_value, discount_amount updated  │
│  • total_amount recalculated                               │
│  • PosDiscount record created                              │
└─────────────────────────────────────────────────────────────┘
```

### 10.3 Refund Flow
```
┌─────────────────────────────────────────────────────────────┐
│  POST /pos/refund/                                          │
│  { order_id, worker_id, amount, payment_method, reason }   │
│                                                             │
│  Types:                                                     │
│  • Full refund: amount = order.total_amount                │
│  • Partial refund: amount <= order.total_amount            │
│                                                             │
│  Actions:                                                   │
│  1. Create PosPayment (negative amount, status=refunded)   │
│  2. Update Order status → "refunded"                       │
│  3. If credit sale: CreditTransaction (adjustment)         │
│  4. If debit sale: DebitTransaction (refund)               │
│  5. Audit log entry                                        │
│                                                             │
│  Permissions: worker must have can_process_refund          │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. Shift Management & Cash Reconciliation

### 11.1 Shift Lifecycle
```
┌─────────────────────────────────────────────────────────────┐
│  SHIFT OPEN                                                 │
│  POST /pos/shift/open/                                      │
│  { device_id, worker_id, opening_cash }                     │
│                                                             │
│  ┌─────────────────────────────────────────┐               │
│  │ CashShift created:                      │               │
│  │ • status = "open"                       │               │
│  │ • opening_cash = worker-entered amount  │               │
│  │ • All totals start at 0                │               │
│  │ • opened_at = now                      │               │
│  └─────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼ (During shift: orders, payments, cash movements)
                          │
┌─────────────────────────────────────────────────────────────┐
│  DURING SHIFT: CASH MOVEMENTS                               │
│  POST /pos/cash/movement/                                   │
│  { shift_id, worker_id, movement_type, amount, reason }    │
│                                                             │
│  Types:                                                     │
│  • payin: Cash added to drawer (green)                     │
│  • payout: Cash removed from drawer (red)                  │
│  • cashdrop: Bank deposit from drawer (blue)               │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  SHIFT CLOSE                                                │
│  POST /pos/shift/close/                                     │
│  { shift_id, worker_id, closing_cash }                      │
│                                                             │
│  Expected Cash Calculation:                                 │
│  expected = opening_cash + total_cash_sales - payouts       │
│           + pay-ins                                         │
│                                                             │
│  ┌─────────────────────────────────────────┐               │
│  │ SHIFT SUMMARY                           │               │
│  │ Opening Cash:      Rs 2,000.00          │               │
│  │ + Cash Sales:      Rs 15,500.00         │               │
│  │ - Payouts:         Rs   500.00          │               │
│  │ + Pay-ins:         Rs 1,000.00          │               │
│  │ = Expected Cash:   Rs 18,000.00         │               │
│  │                                         │               │
│  │ Closing Cash:      Rs 17,850.00         │               │
│  │ Difference:        Rs  -150.00 (SHORT)  │               │
│  └─────────────────────────────────────────┘               │
│                                                             │
│  On Close:                                                  │
│  • status = "closed"                                       │
│  • closing_cash, cash_difference calculated                │
│  • closed_at = now                                         │
│  • All shift totals finalized                              │
└─────────────────────────────────────────────────────────────┘
```

### 11.2 Z-Report (End of Day)
```
┌─────────────────────────────────────────────────────────────┐
│  GET /pos/z-report/?date=YYYY-MM-DD                        │
│                                                             │
│  ┌─────────────────────────────────────────┐               │
│  │           ZENTRO - Z REPORT             │               │
│  │           Date: 2025-07-18              │               │
│  │                                         │               │
│  │  REVENUE                                │               │
│  │  Total Revenue:      Rs 45,200.00       │               │
│  │  Total Orders:       87                 │               │
│  │  Avg Order Value:    Rs 519.54          │               │
│  │  Discounts Given:    Rs 2,300.00        │               │
│  │                                         │               │
│  │  CASH SUMMARY                          │               │
│  │  Opening Cash:       Rs 2,000.00        │               │
│  │  Cash Sales:         Rs 28,500.00       │               │
│  │  Cash Payouts:       Rs 1,200.00        │               │
│  │  Cash Pay-ins:       Rs 3,000.00        │               │
│  │  Expected in Drawer: Rs 32,300.00       │               │
│  │                                         │               │
│  │  PAYMENT BREAKDOWN                      │               │
│  │  Cash:    Rs 28,500 (63%)  ████████░░  │               │
│  │  Card:    Rs 12,000 (27%)  █████░░░░░  │               │
│  │  QR:      Rs  3,200 (7%)   █░░░░░░░░░  │               │
│  │  Wallet:  Rs  1,500 (3%)   ░░░░░░░░░░  │               │
│  │                                         │               │
│  │  TOP ITEMS           │  STAFF REPORT   │               │
│  │  1. Latte (23)       │  Worker A: 34   │               │
│  │  2. Cappuccino (18)  │  Worker B: 28   │               │
│  │  3. Croissant (12)   │  Worker C: 25   │               │
│  │                                         │               │
│  │  CREDIT / DEBIT / REFUNDS              │               │
│  │  Credit Sales:       Rs 5,000.00        │               │
│  │  Debit Purchases:    Rs 2,300.00        │               │
│  │  Refunds:            Rs  800.00         │               │
│  └─────────────────────────────────────────┘               │
│                                                             │
│  Print: Thermal 80mm format via browser print              │
└─────────────────────────────────────────────────────────────┘
```

---

## 12. Staff Management & Scheduling

```
┌─────────────────────────────────────────────────────────────┐
│  WORKER CREATION                                            │
│  POST /pos/workers/create/                                  │
│  { display_name, pin, role,                                 │
│    can_apply_discount, can_process_refund,                  │
│    can_close_shift, can_view_reports }                      │
│                                                             │
│  Roles: cashier, waiter, manager, admin                     │
│  PIN: 4-8 digits, stored as SHA-256 hash                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  WORKER PERMISSIONS                                         │
│                                                             │
│  ┌──────────────┬──────────┬──────────┬──────────┐         │
│  │ Role         │ Discount │ Refund   │ Reports  │         │
│  ├──────────────┼──────────┼──────────┼──────────┤         │
│  │ Cashier      │    ✗     │    ✗     │    ✗     │         │
│  │ Waiter       │    ✗     │    ✗     │    ✗     │         │
│  │ Manager      │    ✓     │    ✓     │    ✓     │         │
│  │ Admin        │    ✓     │    ✓     │    ✓     │         │
│  └──────────────┴──────────┴──────────┴──────────┘         │
│  (Permissions are per-worker, configurable by admin)       │
│                                                             │
│  PIN Lockout: 5 failed attempts → locked 15 minutes        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  STAFF SCHEDULING                                           │
│  POST /pos/schedules/create/                                │
│  { worker_id, shift_date, start_time, end_time, role }     │
│                                                             │
│  GET /pos/schedules/ → List all schedules                   │
│  DELETE /pos/schedules/{id}/delete/ → Remove schedule       │
│                                                             │
│  Weekly Calendar View (Mon-Sun)                             │
│  • Add shift per worker per day                            │
│  • Delete shift (hover → trash icon)                       │
│  • Navigate weeks (prev/next)                              │
│  • Status: scheduled → confirmed → completed / cancelled   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  STAFF DAILY REPORT                                         │
│  GET /pos/staff-report/?date=YYYY-MM-DD                    │
│                                                             │
│  Per-worker summary:                                        │
│  • Orders processed                                         │
│  • Revenue generated                                        │
│  • Discounts applied                                        │
│  • Refunds processed                                        │
│  • Shift duration                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 13. Merchant Admin Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│  /merchant/  DASHBOARD OVERVIEW                             │
│                                                             │
│  ┌─────────────────────────────────────────┐               │
│  │  Good Morning, Zentro Cafe!             │               │
│  │                                         │               │
│  │  ┌──────────┬──────────┬──────┬──────┐ │               │
│  │  │ Revenue  │ Orders   │ Avg  │Active│ │               │
│  │  │ Rs 12.5K │   24     │Rs 520│  156 │ │               │
│  │  └──────────┴──────────┴──────┴──────┘ │               │
│  │                                         │               │
│  │  Revenue Trend (12 days bar chart)      │               │
│  │  Top Sellers: Latte(8), Cappuccino(6)   │               │
│  └─────────────────────────────────────────┘               │
│                                                             │
│  SIDEBAR NAV:                                               │
│  ├── Overview     → Dashboard with stats + charts          │
│  ├── Orders       → Incoming/In-progress/Completed orders  │
│  │   ├── Auto-refresh every 8 seconds                      │
│  │   ├── Sound alert on new order                          │
│  │   └── One-click status advance                          │
│  ├── Menu         → CRUD menu items                        │
│  │   ├── Image upload (WebP optimized)                     │
│  │   ├── Category management                               │
│  │   └── Toggle availability                               │
│  ├── Tables & QR  → Generate/manage tables                 │
│  │   ├── Bulk generate 1-200 tables                        │
│  │   ├── QR preview/download/print per table              │
│  │   └── Toggle table ordering on/off                      │
│  ├── Loyalty      → Missions/Rewards/Punch Cards/Txns     │
│  │   ├── Missions CRUD (order_count, spend_amount, streak)│
│  │   ├── Rewards CRUD (emoji, name, points_cost, stock)   │
│  │   ├── Punch Card templates + proof code confirmation   │
│  │   ├── Customer list management                         │
│  │   └── Full transaction ledger                           │
│  ├── Specials     → Today's Special promotions             │
│  │   ├── Link to menu items or rewards                    │
│  │   ├── Toggle active/inactive                            │
│  │   └── Auto-popup on customer storefront                │
│  ├── Analytics    → Revenue charts, top items, top         │
│  │                  customers, order history (60 days)     │
│  └── Store        → Profile, branding, card design,        │
│                      theme, QR code, settings              │
└─────────────────────────────────────────────────────────────┘
```

### Order Management (Merchant)
```
┌─────────────────────────────────────────────────────────────┐
│  /merchant/orders                                           │
│                                                             │
│  Three Columns:                                             │
│  ┌────────────┬──────────────┬──────────────┐              │
│  │ INCOMING   │ IN PROGRESS  │ COMPLETED    │              │
│  │ (pending)  │(confirmed,   │ (completed,  │              │
│  │            │ preparing,   │  cancelled)  │              │
│  │ [Accept]   │  ready)      │              │              │
│  │ [Reject]   │ [Start Prep] │              │              │
│  │            │ [Ready]      │              │              │
│  └────────────┴──────────────┴──────────────┘              │
│                                                             │
│  • 8-second auto-refresh                                    │
│  • Sound alert (Web Audio oscillator) on new order         │
│  • Pulse ring animation on new order cards                 │
│  • Fulfillment filter: All / Dine-in / Pickup / Delivery   │
│  • Cancel modal with reasons:                              │
│    - Customer Request                                      │
│    - Out of Stock                                          │
│    - Store Closing                                         │
│    - Other                                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 14. Table QR Ordering Flow

### 14.1 Table Setup (Merchant Side)
```
/merchant/tables
     │
     ▼
┌─────────────────────────────────────────────────────┐
│  1. Enable Table Ordering                           │
│     PATCH /merchants/me/update/                      │
│     { table_ordering_enabled: true }                 │
│                                                     │
│  2. Generate Tables                                 │
│     POST /merchants/tables/generate/                 │
│     { count: 20, name_prefix: "Table" }             │
│     → Creates Table 1 through Table 20              │
│     → Each gets unique public_token (TBL-xxxxx)    │
│                                                     │
│  3. Print QR Codes                                  │
│     URL: {origin}/m/{slug}/table/{token}            │
│     → Print optimized cards with logo + QR          │
│     → Place on each table                           │
└─────────────────────────────────────────────────────┘
```

### 14.2 Customer Table Ordering
```
┌─────────────────────────────────────────────────────────────┐
│  CUSTOMER SCANS TABLE QR                                    │
│  URL: /m/{merchant-slug}/table/{table-token}               │
│                                                             │
│  1. Resolve Table                                           │
│     GET /merchants/public/{slug}/tables/{token}/           │
│     → { table_id, table_name, table_number, merchant }    │
│                                                             │
│  2. Set Context                                             │
│     Zustand Store:                                          │
│     { merchantSlug, tableToken, tableId, tableName }       │
│     fulfillment_type = "dine_in"                           │
│                                                             │
│  3. Auto-join merchant if needed                           │
│     POST /loyalty/merchant-profiles/join/                   │
│                                                             │
│  4. Browse Menu                                             │
│     Menu displayed from merchant dashboard                  │
│                                                             │
│  5. Place Order                                             │
│     POST /orders/create/ {                                  │
│       merchant_id, items, notes,                           │
│       fulfillment_type: "dine_in",                         │
│       table_token: "TBL-xxxxx"                             │
│     }                                                       │
│                                                             │
│  6. Order appears on merchant's /merchant/orders           │
│     AND on POS incoming orders panel                       │
└─────────────────────────────────────────────────────────────┘
```

### 14.3 POS Table Order (alternative path)
```
┌─────────────────────────────────────────────────────────────┐
│  POST /pos/table/{token}/order/                             │
│  { items, notes, customer_name }                            │
│                                                             │
│  • Public endpoint (no auth)                                │
│  • Server resolves table from token                        │
│  • Creates Order (source=table_qr, status=pending)        │
│  • Server calculates prices from MenuItem                  │
│  • Notifies POS (appears in IncomingOrdersPanel)           │
└─────────────────────────────────────────────────────────────┘
```

---

## 15. Point Transfer (Peer-to-Peer)

```
┌─────────────────────────────────────────────────────────────┐
│  PREREQUISITES                                              │
│  • Merchant must have allow_point_transfer = true          │
│  • Both sender and receiver must have joined the merchant  │
│  • Sender needs receiver's 6-char transfer_code            │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CUSTOMER SENDS POINTS                                      │
│  POST /loyalty/transfers/create/                            │
│  { receiver_transfer_code, merchant_id, amount,            │
│    description }                                            │
│                                                             │
│  Validation:                                                │
│  • Same merchant                                            │
│  • Positive amount                                          │
│  • Not self-transfer                                        │
│  • Sufficient balance                                       │
│  • Receiver exists and has joined same merchant            │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVER PROCESSING                                          │
│                                                             │
│  1. transfer_points(sender_wallet, receiver_wallet, amount) │
│  2. Deduct from sender: points_balance -= amount           │
│     → PointTransaction (type=TRANSFER_SENT, points=-amount)│
│  3. Add to receiver: points_balance += amount              │
│     → PointTransaction (type=TRANSFER_RECEIVED)            │
│  4. Both transactions linked by transfer_group UUID       │
│  5. Notifications sent to both parties                     │
└─────────────────────────────────────────────────────────────┘

QR SCANNER FLOW:
  /transfers → Receive Tab → Shows QR code (zentro-transfer:{code})
  Sender: /transfers → Send Tab → Scan QR → Parse code → Enter amount → Send
```

---

## 16. Today's Specials

```
┌─────────────────────────────────────────────────────────────┐
│  MERCHANT CREATES SPECIAL                                   │
│  POST /loyalty/merchant/specials/                            │
│  { title, description, image_url,                           │
│    linked_menu_item_id, linked_reward_id, is_active }       │
│                                                             │
│  • linked_menu_item → "Buy this item today!"               │
│  • linked_reward → "Redeem this reward today!"             │
│  • Both optional (can be standalone promotion)             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  MERCHANT MANAGES SPECIALS                                  │
│  GET /loyalty/merchant/specials/ → List all specials        │
│  PATCH /loyalty/merchant/specials/{id}/ → Edit special      │
│  DELETE /loyalty/merchant/specials/{id}/ → Delete special   │
│                                                             │
│  /merchant/specials → UI with toggle active/inactive       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CUSTOMER SEES SPECIALS                                     │
│  GET /loyalty/specials/{slug}/ → Active specials for store  │
│                                                             │
│  Displayed as:                                              │
│  • TodaySpecialPopup (auto-popup on merchant storefront)   │
│  • Banner on /customer/merchant/{slug}                     │
│  • Menu items highlighted with "Today's Special" badge     │
│                                                             │
│  Notification:                                              │
│  • type=special_offer sent to joined customers             │
│  • Pushed via WebSocket in real-time                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 17. Membership Card Design & QR Tokens

### 17.1 Card Design System
```
┌─────────────────────────────────────────────────────────────┐
│  MERCHANT DESIGNS MEMBERSHIP CARD                           │
│  GET/PATCH /loyalty/merchant/card-design/                   │
│                                                             │
│  Fields:                                                    │
│  ┌─────────────────────────────────────────┐               │
│  │  card_title: "VIP Member"               │               │
│  │  card_subtitle: "Loyalty Rewards"       │               │
│  │  primary_color: #FF6B35                 │               │
│  │  secondary_color: #004E89              │               │
│  │  accent_color: #FCBF49                 │               │
│  │  text_mode: light / dark               │               │
│  │  background_type: solid / image / pattern│              │
│  │  background_image: URL                  │               │
│  │  background_pattern: zentro_dots / geometric / diamonds │
│  │  tier_style: default / minimal / badge  │               │
│  │  logo: URL                              │               │
│  │  points_label: "Zentro Points"          │               │
│  │  membership_label: "Member Since"       │               │
│  │  show_lifetime_points: true             │               │
│  │  show_joined_date: true                 │               │
│  │  show_qr_shortcut: true                 │               │
│  │  show_color_overlay: true               │               │
│  └─────────────────────────────────────────┘               │
│                                                             │
│  POST /loyalty/merchant/card-design/publish/ → Publish card │
│  (is_published = true → visible to customers)              │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CUSTOMER VIEWS CARD                                        │
│  GET /loyalty/membership-cards/ → All merchant cards        │
│  /cards → Card stack display (swipe between merchants)     │
│  /cards/{merchantSlug} → Individual card with details       │
│                                                             │
│  Shows:                                                     │
│  • Designed card with merchant branding                     │
│  • Current tier + points balance                            │
│  • QR shortcut for transfers                               │
│  • Lifetime points + joined date (if enabled)              │
└─────────────────────────────────────────────────────────────┘
```

### 17.2 Membership QR Tokens
```
┌─────────────────────────────────────────────────────────────┐
│  QR TOKEN SYSTEM                                            │
│                                                             │
│  Each customer-merchant membership gets a rotatable QR:    │
│  GET /api/customer/memberships/{slug}/qr/                  │
│  → Returns current token (MQR_XXXXXXXXXXXX)                │
│                                                             │
│  POST /api/customer/memberships/{slug}/qr/                 │
│  → Rotates token (invalidates old, creates new version)    │
│                                                             │
│  Resolving:                                                 │
│  GET /loyalty/qr/{public_token}/                           │
│  → Resolves token → Returns membership info                │
│  → Used for: transfers, check-in, identification           │
│                                                             │
│  Token Versioning:                                          │
│  • token_version increments on each rotation               │
│  • is_active flag controls validity                        │
│  • Previous tokens become invalid immediately             │
└─────────────────────────────────────────────────────────────┘
```

### 17.3 Customer Management (Merchant)
```
┌─────────────────────────────────────────────────────────────┐
│  MERCHANT CUSTOMER LIST                                     │
│  GET /loyalty/merchant/customers/                           │
│  → All customers who joined this merchant                  │
│  → Shows: name, membership#, points, tier, last active     │
│                                                             │
│  MERCHANT CUSTOMER DETAIL                                   │
│  GET /loyalty/merchant/customers/{membership_id}/           │
│  → Individual customer profile at this merchant            │
│  → Transaction history, wallet, punch cards                │
└─────────────────────────────────────────────────────────────┘
```

---

## 18. Offline Sync & Conflict Resolution

```
┌─────────────────────────────────────────────────────────────┐
│  OFFLINE ARCHITECTURE (POS)                                 │
│                                                             │
│  IndexedDB: zentro-pos (4 object stores)                   │
│  ├── orders: OfflineOrder (cart_snapshot for display)      │
│  ├── payments: OfflinePayment                              │
│  ├── sync_queue: Pending mutations (type, endpoint, body)  │
│  └── menu_cache: Cached menu for offline browsing         │
│                                                             │
│  Background Sync:                                           │
│  • 30-second interval timer                                │
│  • Also fires on window 'online' event                     │
│  • Processes queue chronologically                         │
│  • Retries 5 times, then marks as permanently failed      │
│  • 100ms delay between requests                            │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  SYNC STATUS BAR (POS sidebar footer)                      │
│                                                             │
│  States:                                                    │
│  • Online, no issues → Hidden                              │
│  • "Offline -- N mutations queued" (amber)                 │
│  • "Syncing..." (spinner)                                  │
│  • "N failed, M pending" (red) + Retry button             │
│  • "N pending sync" (blue) + Sync Now button               │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CONFLICT RESOLUTION (/pos/conflicts)                      │
│                                                             │
│  Conflict Types:                                            │
│  1. Order Conflicts                                         │
│     → Server and client versions differ                    │
│     → Resolution: Keep Server / Keep Offline               │
│  2. Payment Conflicts                                       │
│     → Same as above                                        │
│  3. Recent Activity                                         │
│     → ProcessedClientMutation records (auto-cleaned >1hr) │
│  4. Local Sync Queue                                        │
│     → Items stuck in IndexedDB                             │
│                                                             │
│  Idempotency: client_mutation_id on orders + payments      │
│  Optimistic Concurrency: version field on Order + Shift    │
└─────────────────────────────────────────────────────────────┘
```

---

## 19. Notification System

```
┌─────────────────────────────────────────────────────────────┐
│  NOTIFICATION TYPES                                         │
│                                                             │
│  ┌────────────────────────┬──────────────┬───────────────┐ │
│  │ Type                   │ Trigger      │ Recipient     │ │
│  ├────────────────────────┼──────────────┼───────────────┤ │
│  │ new_order              │ Order created│ Merchant      │ │
│  │ order_update           │ Status change│ Customer      │ │
│  │ points_earned          │ Order complete│ Customer     │ │
│  │ mission_completed      │ Target met   │ Customer      │ │
│  │ reward_redeemed        │ Redemption   │ Merchant      │ │
│  │ punch_card_completed   │ Card full    │ Customer      │ │
│  │ special_offer          │ New special  │ Customer      │ │
│  │ transfer_sent          │ Points sent  │ Sender        │ │
│  │ transfer_received      │ Points recv'd│ Receiver      │ │
│  └────────────────────────┴──────────────┴───────────────┘ │
│                                                             │
│  Endpoints:                                                 │
│  • GET /notifications/ (last 7 days, max 100)             │
│  • GET /notifications/unread-count/                        │
│  • PATCH /notifications/{id}/read/                         │
│  • POST /notifications/read-all/                           │
│  • DELETE /notifications/clear/                            │
│                                                             │
│  POS Notifications:                                         │
│  • GET /pos/notifications/ (last 30)                       │
│  • POST /pos/notifications/{id}/read/                      │
│                                                             │
│  Delivery Methods:                                          │
│  • Database persistence (all notifications)                │
│  • WebSocket push (Django Channels) → real-time toasts    │
│  • Toast notification via GlobalNotificationToasts component│
└─────────────────────────────────────────────────────────────┘
```

---

## 20. PWA & Real-Time Features

### 20.1 Progressive Web App
```
┌─────────────────────────────────────────────────────────────┐
│  PWA FEATURES                                               │
│                                                             │
│  Service Worker:                                            │
│  • Pre-caches app shell for offline browsing               │
│  • Background sync for offline orders                      │
│  • Cache-first strategy for static assets                  │
│                                                             │
│  Install Prompt:                                            │
│  • PwaProvider detects installability                      │
│  • InstallZentroButton shows install banner               │
│  • Custom install flow (not browser default)              │
│                                                             │
│  Offline Fallback:                                          │
│  /offline → Shown when connection lost                     │
│  • Cached pages still accessible                          │
│  • Clear indication of offline state                      │
│                                                             │
│  Assets:                                                    │
│  • manifest.json (app metadata)                           │
│  • apple-touch-icon (iOS home screen)                     │
│  • Service worker with cache strategies                   │
└─────────────────────────────────────────────────────────────┘
```

### 20.2 Real-Time WebSocket Notifications
```
┌─────────────────────────────────────────────────────────────┐
│  WEBSOCKET ARCHITECTURE                                     │
│                                                             │
│  Django Channels → WebSocket connection                    │
│  • Established in root component (__root.tsx)              │
│  • GlobalNotificationToasts component listens             │
│                                                             │
│  Real-Time Events:                                          │
│  • new_order → Merchant sees incoming order instantly      │
│  • order_update → Customer sees status change              │
│  • points_earned → Instant points notification            │
│  • special_offer → Today's special popup                   │
│  • transfer_sent/received → Transfer confirmation         │
│                                                             │
│  Fallback:                                                  │
│  • Polling every 30 seconds if WebSocket unavailable      │
│  • Database-persisted notifications survive disconnect    │
└─────────────────────────────────────────────────────────────┘
```

---

## 21. Data Model Relationships

```
User (AUTH_USER_MODEL)
 ├── OneToOne → CustomerProfile
 │     ├── FK → CustomerMerchantProfile.customer
 │     │     ├── FK → CustomerMerchantWallet.membership
 │     │     ├── FK → PointTransaction.membership
 │     │     └── FK → MembershipQrToken.membership
 │     ├── FK → CustomerMerchantWallet.customer
 │     │     └── FK → PointTransaction.wallet
 │     ├── FK → PointTransaction.customer
 │     ├── FK → CustomerPunchCard.customer
 │     ├── FK → CustomerMission.customer
 │     ├── FK → Redemption.customer
 │     ├── FK → Order.customer
 │     ├── FK → CreditAccount.customer
 │     └── FK → DebitAccount.customer
 │
 ├── OneToOne → MerchantProfile
 │     ├── FK → MenuItem.merchant
 │     ├── FK → MerchantTable.merchant → Order.table
 │     ├── OneToOne → LoyaltyRules.merchant
 │     ├── OneToOne → MerchantMembershipCardDesign.merchant
 │     ├── FK → MerchantPunchCard.merchant
 │     │     └── FK → CustomerPunchCard.punch_card
 │     ├── FK → Mission.required_merchant
 │     ├── FK → Reward.merchant
 │     │     └── FK → Redemption.reward
 │     ├── FK → TodaySpecial.merchant
 │     │     ├── FK → TodaySpecial.linked_menu_item → MenuItem
 │     │     └── FK → TodaySpecial.linked_reward → Reward
 │     ├── FK → PosDevice.merchant
 │     ├── FK → ShiftWorker.merchant
 │     ├── FK → CashShift.merchant
 │     │     ├── FK → PosPayment.shift
 │     │     ├── FK → PosCashMovement.shift
 │     │     └── FK → Order.cash_shift
 │     ├── FK → Order.merchant
 │     │     ├── FK → OrderItem.order
 │     │     ├── FK → PosPayment.order
 │     │     ├── FK → PosDiscount.order
 │     │     └── FK → PointTransaction.order
 │     ├── FK → CreditAccount.merchant
 │     │     └── FK → CreditTransaction.account
 │     ├── FK → DebitAccount.merchant
 │     │     └── FK → DebitTransaction.account
 │     ├── FK → StaffSchedule.merchant
 │     └── FK → PosAuditLog.merchant
 │
 ├── FK → Notification.user
 ├── FK → PasswordResetToken.user
 └── FK → PosAuditLog.user
```

### Entity Count by Domain
```
Domain                      │ Models │ Count
────────────────────────────┼────────┼──────
Auth & Users                │ User, CustomerProfile, PasswordResetToken │ 3
Merchant & Catalog          │ MerchantProfile, MenuItem, MerchantTable │ 3
Loyalty Core                │ CustomerMerchantProfile, CustomerMerchantWallet,
                            │ LoyaltyRules, PointTransaction │ 4
Punch Cards                 │ MerchantPunchCard, CustomerPunchCard │ 2
Missions                    │ Mission, CustomerMission │ 2
Rewards & Redemption        │ Reward, Redemption │ 2
Membership & Design         │ MembershipQrToken, MerchantMembershipCardDesign,
                            │ TodaySpecial │ 3
Orders                      │ Order, OrderItem │ 2
Notifications               │ Notification │ 1
POS Devices & Workers       │ PosDevice, ShiftWorker │ 2
POS Shifts & Cash           │ CashShift, PosCashMovement │ 2
POS Payments & Discounts    │ PosPayment, PosDiscount │ 2
POS Credit/Debit            │ CreditAccount, CreditTransaction,
                            │ DebitAccount, DebitTransaction │ 4
POS Infrastructure          │ PosAuditLog, ProcessedClientMutation,
                            │ StaffSchedule │ 3
────────────────────────────┴────────┼──────
                             TOTAL   │ 40
```

---

## 22. API Endpoint Map

### Summary by Feature Area
```
┌──────────────────────────────────┬────────────┬──────────┐
│ Feature Area                     │ Base URL   │ Endpoints│
├──────────────────────────────────┼────────────┼──────────┤
│ System / Health                  │ /healthz/  │ 2        │
│ Authentication & Accounts        │ /api/auth/ │ 9        │
│ Media Upload                     │ /api/media/│ 1        │
│ Merchants & Menu                 │ /api/merchants/ │ 25  │
│ Loyalty (general)                │ /api/loyalty/    │ 55  │
│ Customer Memberships             │ /api/customer/memberships/ │ 6 │
│ Orders                           │ /api/orders/     │ 8   │
│ Notifications                    │ /api/notifications/ │ 5  │
│ POS System                       │ /api/pos/  │ 58       │
├──────────────────────────────────┼────────────┼──────────┤
│ GRAND TOTAL                      │            │ ~169     │
└──────────────────────────────────┴────────────┴──────────┘
```

### Loyalty Endpoint Groups (Updated)
```
Group                    │ Endpoints │ Key URLs
─────────────────────────┼───────────┼─────────────────────────────
Memberships / Join       │ 6         │ /loyalty/merchant-profiles/join/, /loyalty/merchant-profiles/mine/
Wallets                  │ 2         │ /loyalty/wallets/mine/, /loyalty/wallets/
Loyalty Rules            │ 1         │ /loyalty/rules/
Transactions             │ 2         │ /loyalty/transactions/, /loyalty/merchant/transactions/
Punch Cards              │ 7         │ /loyalty/merchant/punch-cards/, /loyalty/punch-cards/
Missions                 │ 5         │ /loyalty/missions/create/, /loyalty/missions/my-missions/
Today's Specials         │ 5         │ /loyalty/specials/{slug}/, /loyalty/merchant/specials/
Rewards                  │ 5         │ /loyalty/rewards/create/, /loyalty/rewards/{id}/redeem/
Redemptions              │ 3         │ /loyalty/redemptions/confirm/, /loyalty/redemptions/merchant/
Leaderboard              │ 1         │ /loyalty/leaderboard/
Transfers                │ 3         │ /loyalty/transfers/create/, /loyalty/merchant/transfers/
Membership Cards         │ 1         │ /loyalty/membership-cards/
QR Tokens                │ 1         │ /loyalty/qr/{token}/
Card Design              │ 3         │ /loyalty/merchant/card-design/
Customer Management      │ 2         │ /loyalty/merchant/customers/
─────────────────────────┼───────────┼─────────────────────────────
LOYALTY TOTAL            │ 55        │
```

### Customer Membership Endpoints (Updated)
```
Group                    │ Endpoints │ Key URLs
─────────────────────────┼───────────┼─────────────────────────────
List Memberships         │ 1         │ /customer/memberships/
Join Merchant            │ 1         │ /customer/memberships/join/
Membership Detail        │ 1         │ /customer/memberships/{slug}/
QR Token Get             │ 1         │ /customer/memberships/{slug}/qr/ (GET)
QR Token Rotate          │ 1         │ /customer/memberships/{slug}/qr/ (POST)
─────────────────────────┼───────────┼─────────────────────────────
CUSTOMER MEMBERSHIP TOTAL│ 6         │
```

### Order Endpoints (Updated)
```
Group                    │ Endpoints │ Key URLs
─────────────────────────┼───────────┼─────────────────────────────
Customer Orders          │ 1         │ /orders/my-orders/
Merchant Orders          │ 1         │ /orders/store-orders/
Create Order             │ 1         │ /orders/create/
Guest Order              │ 1         │ /orders/guest-create/
Order History            │ 1         │ /orders/merchant-history/
Order Detail             │ 1         │ /orders/{id}/
Update Status            │ 1         │ /orders/{id}/update-status/
Cancel Order             │ 1         │ /orders/{id}/cancel/
─────────────────────────┼───────────┼─────────────────────────────
ORDER TOTAL              │ 8         │
```

### POS Endpoint Groups (Updated)
```
Group               │ Endpoints │ Key URLs
────────────────────┼───────────┼─────────────────────────────
Auth & Bootstrap    │ 5         │ /pos/auth/login, /pos/auth/bootstrap, /pos/auth/device-bootstrap
Device Management   │ 4         │ /pos/device/register, /pos/devices/
Worker Management   │ 5         │ /pos/workers/, /pos/worker/login
Shift Management    │ 5         │ /pos/shift/open, /pos/shift/close, /pos/shift/active, /pos/shifts/
POS Orders          │ 4         │ /pos/order/create, /pos/orders/, /pos/order/status/
Receipts & Bills    │ 1         │ /pos/receipt/{id}
Payments            │ 3         │ /pos/payment/create, /pos/payment/split, /pos/payments/
Discounts           │ 1         │ /pos/discount/apply
Cash Movements      │ 2         │ /pos/cash/movement, /pos/cash/movements
Customer Search     │ 1         │ /pos/customers/search
Refunds             │ 1         │ /pos/refund
Credit Accounts     │ 3         │ /pos/credit/accounts, /pos/credit/sale, /pos/credit/repayment
Debit Accounts      │ 4         │ /pos/debit/accounts, /pos/debit/topup, /pos/debit/purchase, /pos/debit/adjustment
Settings            │ 2         │ /pos/settings/, /pos/settings/update/
Menu Snapshot       │ 1         │ /pos/menu/snapshot
Audit Logs          │ 1         │ /pos/audit
Z-Report            │ 1         │ /pos/z-report
Staff Report        │ 1         │ /pos/staff-report
Conflict Resolution │ 3         │ /pos/conflicts/, /pos/conflicts/resolve/, /pos/conflicts/clear-mutations/
Table QR (Public)   │ 2         │ /pos/table/{token}/menu, /pos/table/{token}/order
Assign Customer     │ 1         │ /pos/order/assign-customer
Notifications       │ 2         │ /pos/notifications/
Staff Scheduling    │ 3         │ /pos/schedules/
────────────────────┼───────────┼─────────────────────────────
POS TOTAL           │ 58        │
```

---

## Complete User Journey Summary

### Customer Flow
```
Sign Up → Login → Browse Stores → Join Merchant → Browse Menu
→ Add to Cart → Checkout (Dine-in/Pickup/Delivery)
→ Place Order → Track Order → Order Complete
→ Earn Points → Update Streak → Punch Card Stamp
→ Mission Progress → Tier Upgrade
→ View Rewards → Redeem Reward → Show Code → Merchant Confirms
→ Generate Punch Proof → Show Code → Merchant Confirms
→ Transfer Points (Send/Receive via QR)
→ View Leaderboard → View Membership Cards
→ View Today's Specials → Quick Action Buttons
```

### Guest Flow
```
Scan Table QR / Visit /guest/merchant/{slug}
→ Browse Menu (no auth) → Add to Cart
→ Checkout with Guest Name → Place Order
→ Order appears on POS/Merchant dashboard
→ Optional: Sign up to link loyalty points
```

### Merchant Flow
```
Sign Up → Onboarding → Configure Store → Upload Logo/Banner
→ Set Theme Color → Generate QR → Design Membership Card
→ Create Menu Items → Enable Features (POS, Tables, Discounts)
→ Create Missions → Create Rewards → Create Punch Cards
→ Create Today's Specials → Set Table Ordering
→ Manage Orders (Accept/Reject/Advance Status)
→ Confirm Reward Redemptions → Confirm Punch Card Proofs
→ View Analytics → View Reports → Generate Z-Report
→ Manage Customer List → Manage Staff Schedule
```

### POS Flow
```
Device Registration → Worker PIN Login → Open Shift
→ Browse Menu → Add to Cart → Link Customer
→ Select Payment Method → Process Payment
→ Print Receipt → Handle Incoming Orders (App/QR/Guest)
→ Record Cash Movements → Apply Discounts (with approval)
→ Process Refunds → Manage Credit/Debit Accounts
→ View Staff Report → Close Shift → View Z-Report → Close Store
→ Handle Sync Conflicts (if offline mode used)
```
