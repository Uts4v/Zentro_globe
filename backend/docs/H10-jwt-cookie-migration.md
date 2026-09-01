# H-10 — JWT Token Storage Remediation Task

Status: **DOCUMENTED (not yet implemented)** — do not mark H-10 as resolved.

## Current state (confirmed)

- Auth transport is SimpleJWT via `Authorization: Bearer <access>` header.
  See `config/settings.py` `SIMPLE_JWT` block (AUTH_HEADER_TYPES `("Bearer",)`).
- Access + refresh tokens are returned **in response bodies only** and are
  persisted by the frontend in **localStorage**:
  - `src/lib/django-api-base.ts` `tokenStore` — keys `dja` (access), `djr` (refresh).
  - `src/lib/auth.tsx` — documents "Stores access + refresh tokens in localStorage."
- Lifetime: access token **15 min** in production, **1 day** when `DEBUG=True`;
  refresh token **30 days**, rotate + blacklist enabled.

## Risk

Storing the long-lived refresh token in `localStorage` means any stored-XSS on
the origin can exfiltrate it and mint tokens without user interaction. The C-1
stored-XSS hardening (upload sanitization) substantially reduces the stored-XSS
attack surface, but does not eliminate it.

## Required change (follow-up task, gated)

1. **Keep the access token in memory only** (JS variable / in-memory store) so
   page-reloads must refresh — never write it to `localStorage`.
2. **Move the refresh token to an `HttpOnly`, `Secure`, `SameSite=Lax/Strict`
   cookie** set by the backend (`accounts/views.py` login/register) instead of
   returning it to the client.
3. Add a `POST /api/auth/refresh/` that reads the refresh cookie (via CSRF
   middleware) rather than a Bearer header.
4. Enable `CSRF_COOKIE_HTTPONLY`/`SESSION_COOKIE_HTTPONLY` and enforce CSRF for
   the cookie-authenticated refresh/rotate calls.
5. Keep the access-token lifetime short (15 min prod) — already configured.
6. After migration, delete the local `dja`/`djr` keys and update
   `django-api-base.ts` / `auth.tsx` token plumbing accordingly.

## Acceptance gate

- After the change, no auth token is readable from `window.localStorage`.
- Stored-XSS test (C-1 pattern) cannot read or replay the refresh token.
- `npm test` on the auth frontend flows (login → refresh → logout) all green.
