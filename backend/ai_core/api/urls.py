from django.urls import path

from . import views

urlpatterns = [
    path("insights/daily/", views.daily_insight, name="ai-daily-insight"),
    path("insights/daily/generate/", views.generate_daily_insight_endpoint, name="ai-daily-insight-generate"),
    path("requests/<str:request_id>/", views.request_status, name="ai-request-status"),
    path("chat/", views.chat, name="ai-chat"),
    path("conversations/", views.conversation_list, name="ai-conversation-list"),
    path("conversations/<str:conversation_id>/", views.conversation_detail, name="ai-conversation-detail"),
]
