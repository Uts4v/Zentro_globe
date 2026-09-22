"""
loyalty/urls.py — mounted at /api/loyalty/
"""

from django.urls import path
from . import views

urlpatterns = [
    # Merchant onboarding + wallets
    path("merchant-profiles/join/", views.merchant_profile_join, name="merchant-profile-join"),
    path("merchant-profiles/mine/", views.merchant_profiles_mine, name="merchant-profiles-mine"),
    path("wallets/mine/", views.wallet_mine, name="wallet-mine"),
    path("wallets/", views.wallets_list, name="wallets-list"),

    path("merchant-profiles/joined/", views.customer_joined_merchants, name="customer-joined-merchants"),
    # Loyalty rules (merchant)
    path("rules/", views.loyalty_rules, name="loyalty-rules"),

    path("punch-cards/<int:pk>/generate-proof/", views.generate_punch_proof,  name="generate-punch-proof"),
path("punch-cards/confirm-proof/",           views.confirm_punch_proof,    name="confirm-punch-proof"),

    # Transactions
    path("transactions/", views.customer_point_transactions, name="customer-transactions"),
    path("merchant/transactions/", views.merchant_point_transactions, name="merchant-transactions"),

    # Punch cards
    path("punch-cards/", views.customer_punch_cards, name="customer-punch-cards"),
    path("punch-cards/<int:pk>/redeem/", views.customer_punch_card_redeem, name="customer-punch-card-redeem"),
    path("merchant/punch-cards/", views.merchant_punch_cards, name="merchant-punch-cards"),
    path("merchant/punch-cards/create/", views.merchant_punch_card_create, name="merchant-punch-card-create"),
    path("merchant/punch-cards/history/", views.merchant_punch_card_history, name="merchant-punch-card-history"),
    path("merchant/punch-cards/<int:pk>/", views.merchant_punch_card_detail, name="merchant-punch-card-detail"),

    # Missions
    path("missions/", views.mission_list, name="mission-list"),
    path("missions/create/", views.mission_create, name="mission-create"),
    path("missions/my-missions/", views.my_missions, name="my-missions"),
    path("missions/merchant/", views.merchant_missions, name="merchant-missions"),
    path("missions/<int:pk>/", views.mission_detail, name="mission-detail"),
    
    #Todays Special
path("specials/<slug:slug>/",          views.customer_today_special,    name="customer-today-special"),
path("merchant/specials/",             views.merchant_specials_list,     name="merchant-specials-list"),
path("merchant/specials/<int:pk>/",    views.merchant_special_detail,    name="merchant-special-detail"),
    # Rewards
    path("rewards/", views.reward_list, name="reward-list"),
    path("rewards/create/", views.reward_create, name="reward-create"),
    path("rewards/merchant/", views.merchant_rewards, name="merchant-rewards"),
    path("rewards/<int:pk>/", views.reward_detail, name="reward-detail"),
    path("rewards/<int:pk>/redeem/", views.redeem_reward, name="reward-redeem"),

    # Redemptions
    path("redemptions/", views.my_redemptions, name="my-redemptions"),
    path("redemptions/confirm/", views.confirm_redemption, name="confirm-redemption"),
    path("redemptions/merchant/", views.merchant_redemptions, name="merchant-redemptions"),

    # Leaderboard
    path("leaderboard/", views.leaderboard, name="leaderboard"),

    # Point Transfers
    path("transfers/create/", views.transfer_create, name="transfer-create"),
    path("transfers/", views.customer_transfers, name="customer-transfers"),
    path("merchant/transfers/", views.merchant_transfer_history, name="merchant-transfers"),

    # Membership Card Stack
    path("membership-cards/", views.membership_cards_list, name="membership-cards-list"),

    # Membership QR
    path("qr/<str:public_token>/", views.membership_qr_resolve, name="membership-qr-resolve"),

    # Merchant Card Design
    path("merchant/card-design/", views.merchant_card_design, name="merchant-card-design"),
    path("merchant/card-design/publish/", views.merchant_card_design_publish, name="merchant-card-design-publish"),

    # Merchant Customer Management
    path("merchant/customers/", views.merchant_customer_list, name="merchant-customer-list"),
    path("merchant/customers/<int:membership_id>/", views.merchant_customer_detail, name="merchant-customer-detail"),
]
