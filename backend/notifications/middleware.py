from urllib.parse import parse_qs
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken


@database_sync_to_async
def get_user_from_token(token_key):
    from accounts.models import User
    try:
        token = AccessToken(token_key)
        # Only accept short-lived WebSocket tokens issued by /api/auth/ws-token/.
        # Long-lived access tokens carry no ws_auth claim and are rejected so
        # they can never leak via query strings into logs/proxies.
        if not token.get("ws_auth"):
            return AnonymousUser()
        return User.objects.get(id=token["user_id"])
    except Exception:
        return AnonymousUser()


class JWTAuthMiddleware:
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        query = parse_qs(scope.get("query_string", b"").decode())
        token = query.get("token", [None])[0]
        scope["user"] = (
            await get_user_from_token(token) if token else AnonymousUser()
        )
        return await self.inner(scope, receive, send)
