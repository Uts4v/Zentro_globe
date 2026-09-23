# System Overview — Zentro

> Evidence-based view of the whole Zentro_globe platform: two runtimes (TanStack React SPA +
> Django/DRF) coordinated over a single PostgreSQL + Redis + Channels realtime layer. Read
> with the domain map in `database.md` and the app graphs in `backend.md` / `frontend.md`.

---

## Big Picture — pillars

```mermaid
flowchart LR
  subgraph FRONT["Frontend — TanStack Start (SSR) + Zustand + React Query"]
    CS["Customer SPA<br/>/ , /m/:slug, /table/:token, /cards, /rewards, /leaderboard"]
    MS["Merchant SPA<br/>/merchant/*, /pos, /customer/merchant/*"]
    PW["PWA / Offline store<br/>+ service-worker (Zen Workbox)"]
  end

  subgraph BACK["Backend — Django 5 + DRF + Daphne (ASGI)"]
    API["REST API (JWT)"]
    WS["Channels WebSockets (realtime)"]
  end

  subgraph INFRA["Infra — Railway / Docker compose"]
    PG[(PostgreSQL)]
    RD[(Redis—pubsub WS layer + Celery broker)]

    subgraph BG["Celery + beat"]
      WK["worker"]
      BT["beat scheduler"]
    end
  end

  CS --> API
  MS --> API
  PW --> API
  WS --> RD
  API --> PG
  API --> RD
  BG --> RD
  WK --> PG
  WK --> RD
```

## Stack details

| Concern | Choice |
|---|---|
| Frontend | TanStack Start (SSR) + React 19, Tailwind v4, shadcn/ui, TanStack Router + Query |
| Auth | Django JWT (SimpleJWT) via Django API — **Supabase removed** (migration doc in README) |
| Realtime | Django Channels (Daphne/ASGI), RedisChannelLayer, JWTAuth WS middleware |
| Background | Celery + Redis broker; bonus: Celery beat — see `background.md` |
| Realtime data bus | Orders/PreP (KDS) + notifications, see `realtime.md` |
| AI | `ai_core` app: rule + LLM hybrid for merchant assistant + AI waiter (see `ai.md`) |
| Storage | Local filesystem / S3 via Django Storage + media-upload view |

## End-to-end: a guest QR order (zoom of the pillars)

```mermaid
sequenceDiagram
    participant G as Guest (mobile)
    participant C as Customer SPA
    participant API as Django REST (ASGI)
    participant O as orders app
    participant PG as PostgreSQL
    participant LOY as loyalty app
    participant WS as Channels

    G->>C: scans QR → /m/:slug/table/:token
    C->>API: GET /api/public/merchants/{slug}/tables/{token}/ [guest]
    API->>O: resolve table (belongs_to merchant, table_ordering_enabled)
    O-->>API: table + menu snapshot
    API-->>C: merchant + menus + catalog
    C->>API: POST /api/orders/guest/ (pick cart)
    API->>O: create Order(source=table_qr) in transaction
    O->>PG: INSERT order + items (snapshot)
    O->>LOY: award loyalty points / punch (via orders flow)
    O->>WS: order.created → preparation/notifications broadcast
    WS-->>C: realtime updates (KDS/status/toast)
    API-->>C: 201 order id + tracking
```

## How the monorepo is organised

```mermaid
graph LR
    ROOT[Zentro_globe]
    ROOT --> SRC[src/ — React+TS frontend]
    ROOT --> BACK[backend/ — Django]
    ROOT --> DOCS[docs/ — knowledge base + verification]
    ROOT --> SCRIPTS[scripts/ — backup/restore/build assistance]
    ROOT --> SUPABASE[supabase/ — migration assets (legacy)]
    SRC --> FEATURES[features/* — 20 feature dirs]
    SRR --- ROUTES[routes/* — TanStack file routes]
    BACK --> APPS[accounts, merchants, orders, pos, loyalty, notifications, ai_core]
    BACK --> CONFIG[config/ — settings, asgi, celery]
```
