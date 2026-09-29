"""Shared fixtures for the offers tests (not a test module itself)."""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import CustomerProfile
from merchants.models import MenuCategory, MenuItem, MenuOption, MenuOptionGroup, MerchantCategory, MerchantProfile
from orders.models import Order
from pos.models import ShiftWorker

from .models import PromotionBenefit, PromotionCampaign, PromotionCondition, PromotionTarget

User = get_user_model()
D = Decimal


class OffersFixture:
    """Mixin: a merchant with a small menu, two customers and a rival merchant."""

    def setUp(self):
        super().setUp()
        cache.clear()
        self.m_user = User.objects.create_user(username="of-m", email="of-m@t.com", password="Pass123!", role="merchant")
        # Seeded by merchants/0026, but a TransactionTestCase flush wipes seed data,
        # so recreate it when missing (the Postgres-only ParallelTests hit this in CI).
        food, _ = MerchantCategory.objects.get_or_create(
            slug="food-drink", defaults={"name": "Food & Drink", "icon": "🍽️"}
        )
        cafe_cat, _ = MerchantCategory.objects.get_or_create(
            slug="cafe", defaults={"name": "Café", "icon": "☕", "parent": food}
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.m_user, business_name="Offer Cafe", slug="offer-cafe", is_approved=True, is_open=True,
            onboarding_complete=True, pos_enabled=True, discounts_enabled=True, allow_pickup=True,
            tax_enabled=True, tax_components=[{"name": "VAT", "rate": 13}], tax_policy="exclusive",
            currency_code="NPR", currency_symbol="Rs", primary_category=cafe_cat,
            city="Kathmandu", area="Thamel", latitude=D("27.7150"), longitude=D("85.3120"),
        )
        self.pizza_cat = MenuCategory.objects.create(merchant=self.merchant, name="Pizza")
        self.drinks_cat = MenuCategory.objects.create(merchant=self.merchant, name="Cold Drinks")
        self.hot_cat = MenuCategory.objects.create(merchant=self.merchant, name="Hot Drinks")

        def item(name, price, cat, **kw):
            return MenuItem.objects.create(
                merchant=self.merchant, name=name, price=price, category=cat.name, category_ref=cat,
                is_available=True, status=MenuItem.STATUS_ACTIVE, **kw,
            )

        self.pizza = item("Pizza", 600, self.pizza_cat)
        self.big_pizza = item("Big Pizza", 900, self.pizza_cat)
        self.coke = item("Coke", 120, self.drinks_cat)
        self.sprite = item("Sprite", 100, self.drinks_cat)
        self.iced_tea = item("Iced Tea", 150, self.drinks_cat)
        self.coffee = item("Coffee", 300, self.hot_cat)
        self.size = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.coffee, name="Size",
            kind=MenuOptionGroup.KIND_VARIANT, required=False, min_select=0, max_select=1,
        )
        self.large = MenuOption.objects.create(group=self.size, merchant=self.merchant, name="Large", price=400)
        # On a 20% Today's Special-style item discount: sells at 400 instead of 500.
        self.momo = item("Momo", 500, self.hot_cat, discount_type="percentage", discount_value=20)

        self.c_user = User.objects.create_user(username="of-c", email="of-c@t.com", password="Pass123!", role="customer")
        self.customer = CustomerProfile.objects.get_or_create(user=self.c_user, defaults={"full_name": "Asha Rai"})[0]
        self.c2_user = User.objects.create_user(username="of-c2", email="of-c2@t.com", password="Pass123!", role="customer")
        self.customer2 = CustomerProfile.objects.get_or_create(user=self.c2_user, defaults={"full_name": "Bikash"})[0]

        self.r_user = User.objects.create_user(username="of-r", email="of-r@t.com", password="Pass123!", role="merchant")
        self.rival = MerchantProfile.objects.create(
            user=self.r_user, business_name="Rival Cafe", slug="rival-offer", is_approved=True, is_open=True,
            pos_enabled=True, currency_code="NPR", currency_symbol="Rs",
        )
        self.rival_item = MenuItem.objects.create(
            merchant=self.rival, name="Rival Tea", price=50, is_available=True, status=MenuItem.STATUS_ACTIVE,
        )
        self.worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Cashier", pin_hash="x", role="manager",
            is_active=True, can_apply_discount=True, can_process_refund=True,
        )

    # ── clients ──────────────────────────────────────────────────────────────

    def client_for(self, user=None):
        client = APIClient()
        if user is not None:
            client.force_authenticate(user)
        return client

    @property
    def as_customer(self):
        return self.client_for(self.c_user)

    @property
    def as_merchant(self):
        return self.client_for(self.m_user)

    # ── campaigns ────────────────────────────────────────────────────────────

    def make_campaign(self, kind="percent_off", *, value=D("20"), scope="order", benefit_targets=(),
                      qualifying_targets=(), qualifying_quantity=1, status="published", merchant=None,
                      reward_quantity=1, max_applications=1, reward_selection="customer_choice", **fields):
        merchant = merchant or self.merchant
        now = timezone.now()
        campaign = PromotionCampaign.objects.create(
            merchant=merchant, title=fields.pop("title", f"{kind} offer"), status=status,
            published_at=now if status == "published" else None, currency_code="NPR", **fields,
        )
        PromotionBenefit.objects.create(
            campaign=campaign, kind=kind, scope=scope,
            value=value if kind in ("percent_off", "amount_off") else None,
            reward_quantity=reward_quantity, max_applications=max_applications, reward_selection=reward_selection,
        )
        for t in benefit_targets:
            PromotionTarget.objects.create(campaign=campaign, role="benefit", **t)
        for t in qualifying_targets:
            PromotionTarget.objects.create(campaign=campaign, role="qualifying", **t)
        if kind == "buy_x_get_y":
            PromotionCondition.objects.create(campaign=campaign, kind="qualifying_items", quantity=qualifying_quantity)
        return campaign

    def claim(self, campaign, user=None):
        resp = self.client_for(user or self.c_user).post(f"/api/offers/{campaign.id}/claim/", {}, format="json")
        assert resp.status_code in (200, 201), resp.data
        return resp.data

    # ── orders ───────────────────────────────────────────────────────────────

    def order_with_offer(self, items, claim_id, *, reward_choice=None, user=None, expect=201):
        payload = {"merchant_id": self.merchant.id, "items": items, "claim_id": claim_id}
        if reward_choice:
            payload["reward_choice"] = reward_choice
        resp = self.client_for(user or self.c_user).post("/api/orders/create/", payload, format="json")
        assert resp.status_code == expect, resp.data
        return resp

    def set_status(self, order_id, new_status):
        resp = self.as_merchant.patch(f"/api/orders/{order_id}/update-status/", {"status": new_status}, format="json")
        assert resp.status_code == 200, resp.data
        return Order.objects.get(pk=order_id)

    def complete(self, order_id):
        self.set_status(order_id, "confirmed")
        return self.set_status(order_id, "completed")

    def pos_order(self, items):
        resp = self.as_merchant.post("/api/pos/order/create/", {"items": items, "fulfillment_type": "pickup"}, format="json")
        assert resp.status_code == 201, resp.data
        return Order.objects.get(pk=resp.data["id"])

    def days(self, n):
        return timezone.now() + timedelta(days=n)
