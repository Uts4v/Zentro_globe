# notifications/routing.py 
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r"^ws/notifications/$", consumers.NotificationConsumer.as_asgi()),
    re_path(
        r"^ws/preparation/(?P<merchant_id>\d+)/(?P<area_id>\d+|all)/$",
        consumers.PreparationConsumer.as_asgi(),
    ),
]