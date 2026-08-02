"""
Root URL configuration for Zentro backend.
All API routes are prefixed with /api/.
"""

from django.contrib import admin
from django.http import JsonResponse
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from accounts.views import upload_image


def healthz(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("healthz/", healthz),
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/media/upload/", upload_image, name="media-upload"),
    path("api/merchants/", include("merchants.urls")),
    path("api/loyalty/", include("loyalty.urls")),
    path("api/customer/memberships/", include("loyalty.customer_urls")),
    path("api/orders/", include("orders.urls")),
    path("api/notifications/", include("notifications.urls")),
    path("api/pos/", include("pos.urls")),
    path("api/ai/", include("ai_core.api.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)