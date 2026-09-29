"""offers/urls.py — mounted at /api/offers/"""

from django.urls import path

from . import pos_views, views

urlpatterns = [
    # Customer marketplace
    path("", views.offer_list, name="offer-list"),
    path("categories/", views.category_list, name="offer-categories"),
    path("areas/", views.area_list, name="offer-areas"),
    path("<int:pk>/", views.offer_detail, name="offer-detail"),
    path("<int:pk>/claim/", views.offer_claim, name="offer-claim"),
    # Customer: My Offers
    path("mine/", views.my_offers, name="my-offers"),
    path("mine/<int:claim_id>/", views.my_offer_detail, name="my-offer-detail"),
    path("mine/<int:claim_id>/preview/", views.my_offer_preview, name="my-offer-preview"),
    # Merchant campaigns
    path("merchant/campaigns/", views.merchant_campaigns, name="merchant-campaigns"),
    path("merchant/campaigns/<int:pk>/", views.merchant_campaign_detail, name="merchant-campaign-detail"),
    path("merchant/campaigns/<int:pk>/stats/", views.merchant_campaign_stats, name="merchant-campaign-stats"),
    path(
        "merchant/campaigns/<int:pk>/<str:action>/",
        views.merchant_campaign_action,
        name="merchant-campaign-action",
    ),
    # POS
    path("pos/lookup/", pos_views.pos_offer_lookup, name="pos-offer-lookup"),
    path("pos/apply/", pos_views.pos_offer_apply, name="pos-offer-apply"),
    path("pos/remove/", pos_views.pos_offer_remove, name="pos-offer-remove"),
    path("pos/redeem-in-store/", pos_views.pos_offer_redeem_in_store, name="pos-offer-redeem-in-store"),
]
