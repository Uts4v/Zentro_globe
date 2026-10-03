# Zentro Loyalty Platform

## Project Analysis & Architecture

This document provides a high-level overview of the Zentro project's architecture, based on its dependencies and structure.

### Core Technologies

The project is a full-stack web application with a decoupled frontend and backend.

- **Frontend Framework**: **[TanStack Start](https://tanstack.com/start/latest)** on top of **React**. A modern framework for building performant, server-first web applications.

- **Backend**: **[Django](https://www.djangoproject.com/)** with **[Django REST Framework](https://www.django-rest-framework.org/)**. A robust Python-based backend that provides a custom API for all business logic. It includes its own authentication system using `djangorestframework-simplejwt`.

- **Authentication Provider**: **[Supabase](https://supabase.com/)**. Used specifically for its authentication service (`supabase-js`) to handle user identity, sign-ups, and logins.

### How It Works: The Components

The application uses a hybrid architecture, separating the frontend, backend business logic, and authentication into distinct services.

#### 1. Frontend (Client-Side)

The user interface is built with **React** and orchestrated by **TanStack Start**.

- **UI Components**: The visual parts of the application (buttons, forms, pages) are React components.
- **API Communication**: The frontend contains helper functions (in `src/lib/django-api-base.ts`) to make authenticated requests to the Django backend.

#### 2. Backend (Django)

This is the core of the application's functionality.

- **API Endpoints**: As defined in `backend/config/urls.py`, it exposes RESTful APIs for `auth`, `merchants`, `loyalty`, and `orders`.
- **Authentication**: The `accounts` app provides endpoints (e.g., `/api/auth/token/`, `/api/auth/register/`) for user management and issues its own JWTs using `rest_framework_simplejwt`. It is a self-contained authentication server.
- **Database**: It manages its own database (SQLite for development, PostgreSQL for production) for storing all application data.

### Migration Plan: Removing Supabase for a Full Django Backend

To improve cost-effectiveness and simplify the architecture, the project can be migrated to use Django for all backend services, including authentication. The Django backend is already configured for this.

#### Steps:

1.  **Update Frontend Login**: Modify the login form to `POST` credentials to the Django endpoint (e.g., `/api/auth/token/`) instead of calling `supabase.auth.signInWithPassword()`.
2.  **Store Tokens**: Save the `access` and `refresh` tokens returned by Django in a secure, client-side location (e.g., memory, secure cookie, or local storage).
3.  **Update API Helpers**: Change the `djangoHeaders()` function in `src/lib/django-api-base.ts` to retrieve the stored access token instead of calling `supabase.auth.getSession()`.
4.  **Replace Other Auth Calls**: Replace all other Supabase auth functions (e.g., for registration, password reset) with API calls to the corresponding Django endpoints in the `accounts` app.
5.  **Remove Supabase Dependencies**: Once all auth logic is migrated, you can remove the `@supabase/supabase-js` package from your frontend project.

#### New Communication Flow (Post-Migration):

1.  A user submits their login credentials from the React frontend.
2.  The frontend sends a `POST` request to the Django backend's `/api/auth/token/` endpoint.
3.  Django verifies the credentials, generates a JWT access token, and returns it to the frontend.
4.  The frontend stores this token.
5.  For subsequent requests (e.g., to `/api/loyalty/`), the frontend attaches the token to the `Authorization: Bearer <django_access_token>` header.
6.  Django validates the token it issued, processes the request, and returns the data.

---

## Core Functionality

The application is a feature-rich loyalty and ordering platform connecting customers with merchants.

### 1. Customer Loyalty Engine (`loyalty` app)

This is the heart of the platform, designed to drive customer engagement. It is highly configurable on a per-merchant basis.

- **Points System**:
  - Merchants define their own `LoyaltyRules`, including how many points are earned per unit of currency spent (e.g., `points_per_npr`).
  - Points are automatically awarded to a customer when a merchant marks an order as `confirmed`. This logic resides in the `_award_loyalty` helper function within the `orders` app, which is an excellent example of cross-app interaction.
  - Customers also earn points by completing `Missions`.

- **Streaks**:
  - The `CustomerProfile` model tracks `streak_days`.
  - When an order is confirmed, the system checks the `last_order_date`. If the new order is on a consecutive day, the streak increases. If there's a gap of more than one day, the streak resets to 1. This encourages daily engagement.

- **Punch Cards**:
  - Each customer gets a virtual `PunchCard` for every merchant they order from.
  - A punch is automatically added when an order is confirmed (`punch_card.add_punch()`).
  - Once the card is full (`punch_count >= punches_to_free`), the customer earns a `free_reward_available`, which they can redeem.

- **Missions & Rewards**:
  - **Missions**: Merchants can create `Missions` (e.g., "Place 5 orders") to incentivize specific actions. The system tracks customer progress in the `CustomerMission` model. When a mission is completed, the customer is automatically awarded the specified `reward_points`.
  - **Rewards**: Merchants can create `Rewards` that customers can purchase with their loyalty points (e.g., "Free Coffee" for 500 points).
  - **Redemptions**: When a customer redeems a reward, the system deducts the points and generates a unique, time-sensitive `Redemption` code. The merchant can then verify this code in their portal to confirm the redemption (`confirm_redemption` view).

### 2. Order Management (`orders` app)

The system facilitates the entire lifecycle of a customer order.

- **Placing an Order**: A customer builds a cart and submits it via the `/api/orders/create/` endpoint. The order is initially created with a `pending` status.
- **Order Flow for Merchants**:
  - Merchants view incoming orders in their dashboard via `/api/orders/store-orders/`.
  - They can update the order status through various stages: `confirmed` -> `preparing` -> `ready` -> `completed`.
  - Crucially, the transition from `pending` to `confirmed` is the trigger for all loyalty awards (points, streaks, punch cards). This is handled atomically within the `update_order_status` view to ensure data consistency.
- **Order Flow for Customers**:
  - Customers can view their order history (`/api/orders/my-orders/`).
  - They have the ability to cancel an order, but only while it is still in `pending` status.

### 3. Merchant Portal (`merchants` app)

Merchants have a dedicated set of tools to manage their presence and offerings on the platform.

- **Profile Management**: Merchants can update their store details, such as name, address, and opening status (`/api/merchants/me/update/`).
- **Menu Management**: The `menuApi` frontend service communicates with Django endpoints (`/api/merchants/menu-items/`) to allow merchants to create, update, delete, and toggle the availability of their menu items.
- **Loyalty Configuration**: Merchants have full control over their loyalty program. They can set their own points rules, create custom missions, and define rewards for their customers through the `/api/loyalty/` endpoints.
- **Analytics**: The `/api/merchants/analytics/` endpoint provides merchants with key data about their performance on the platform.

### 4. Customer Experience

The frontend (`src/lib/api.ts`) provides a clean, typed interface for interacting with all backend features.

- **Discoverability**: Customers can browse a list of merchants and their menus.
- **Loyalty Tracking**: Customers have a profile (`/api/auth/me/`) where they can see their points balance, streak, and mission progress (`/api/loyalty/missions/my-missions/`).
- **Leaderboard**: A public leaderboard (`/api/loyalty/leaderboard/`) adds a competitive, gamified element to the experience, showing top customers by points.

To improve cost-effectiveness and simplify the architecture, the project can be migrated to use Django for all backend services, including authentication. The Django backend is already configured for this.

#### Steps:

1.  **Update Frontend Login**: Modify the login form to `POST` credentials to the Django endpoint (e.g., `/api/auth/token/`) instead of calling `supabase.auth.signInWithPassword()`.
2.  **Store Tokens**: Save the `access` and `refresh` tokens returned by Django in a secure, client-side location (e.g., memory, secure cookie, or local storage).
3.  **Update API Helpers**: Change the `djangoHeaders()` function in `src/lib/django-api-base.ts` to retrieve the stored access token instead of calling `supabase.auth.getSession()`.
4.  **Replace Other Auth Calls**: Replace all other Supabase auth functions (e.g., for registration, password reset) with API calls to the corresponding Django endpoints in the `accounts` app.
5.  **Remove Supabase Dependencies**: Once all auth logic is migrated, you can remove the `@supabase/supabase-js` package from your frontend project.

#### New Communication Flow (Post-Migration):

1.  A user submits their login credentials from the React frontend.
2.  The frontend sends a `POST` request to the Django backend's `/api/auth/token/` endpoint.
3.  Django verifies the credentials, generates a JWT access token, and returns it to the frontend.
4.  The frontend stores this token.
5.  For subsequent requests (e.g., to `/api/loyalty/`), the frontend attaches the token to the `Authorization: Bearer <django_access_token>` header.
6.  Django validates the token it issued, processes the request, and returns the data.

---

## Docker Deployment

### Quick Start

```bash
# Build and start all services
docker compose up --build

# Or run in detached mode
docker compose up --build -d

# Stop everything
docker compose down

# Stop and remove database data
docker compose down -v
```

### Services

| Service    | Port | Description                                   |
| ---------- | ---- | --------------------------------------------- |
| `frontend` | 3000 | TanStack Start (React SSR)                    |
| `backend`  | 8000 | Django + Daphne (ASGI with WebSocket support) |
| `db`       | 5432 | PostgreSQL 16                                 |
| `redis`    | 6379 | Redis 7 (channels + Celery)                   |

### Before Sharing

Update these secrets in `docker-compose.yml`:

- **SECRET_KEY** - Generate with:

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

- **POSTGRES_PASSWORD** - Use a strong password
- **GROQ_API_KEY** - Add to `backend` environment if you need AI features

### First Run

After `docker compose up --build`, the backend will auto-migrate the database.
To create an admin superuser:

```bash
docker compose exec backend python manage.py createsuperuser
```
