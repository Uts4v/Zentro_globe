# notification/urls.py 
from django.urls import path
from . import views

urlpatterns = [
    path("",              views.notification_list, name="notification-list"),
    path("unread-count/",  views.unread_count,      name="notification-unread-count"),
    path("<int:pk>/read/", views.mark_read,        name="notification-read"),
    path("read-all/",      views.mark_all_read,    name="notification-read-all"),
    path("clear/",         views.clear_all,        name="notification-clear-all"),
    path("vapid-public-key/", views.vapid_public_key, name="notification-vapid-key"),
    path("subscribe/",     views.push_subscribe,   name="notification-subscribe"),
    path("unsubscribe/",   views.push_unsubscribe, name="notification-unsubscribe"),
]