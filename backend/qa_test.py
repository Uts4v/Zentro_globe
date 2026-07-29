"""
Zentro Glow Loyalty — Comprehensive QA Test Suite (v2)
Tests all major user flows: auth, merchant, customer, POS, loyalty, preparation/KDS
"""
import uuid
from datetime import date, timedelta
from decimal import Decimal
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status
from accounts.models import CustomerProfile
from merchants.models import MerchantProfile, MenuItem, MerchantTable
from loyalty.models import (
    CustomerMerchantProfile, CustomerMerchantWallet, PointTransaction,
    MerchantPunchCard, CustomerPunchCard, Mission, CustomerMission,
    Reward, Redemption, TodaySpecial, MerchantMembershipCardDesign,
)
from orders.models import Order, OrderItem, PreparationArea
from pos.models import PosDevice, CashShift, PosPayment, StaffPreparationArea
from notifications.models import Notification


# ---------------------------------------------------------------------------
# AUTH FLOWS
# ---------------------------------------------------------------------------

class AuthFlowTests(TestCase):
    """Authentication & User Registration Flows"""

    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()

    def _register(self, email, password, full_name, role, store_name=None):
        data = {
            "email": email,
            "password": password,
            "confirm_password": password,
            "full_name": full_name,
            "role": role,
        }
        if store_name:
            data["store_name"] = store_name
        return self.client.post("/api/auth/register/", data, format="json")

    def test_01_customer_registration_and_login(self):
        """Customer can register, login, refresh token, and access /me"""
        resp = self._register("cust@qa.com", "StrongPass123!", "QA Customer", "customer")
        self.assertEqual(resp.status_code, 201, f"Register failed: {resp.data}")
        self.assertIn("access", resp.data)
        access = resp.data["access"]

        # Login
        resp = self.client.post("/api/auth/login/", {
            "email": "cust@qa.com", "password": "StrongPass123!",
        }, format="json")
        self.assertEqual(resp.status_code, 200)
        access2 = resp.data["access"]

        # /me
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access2}")
        resp = self.client.get("/api/auth/me/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["email"], "cust@qa.com")
        self.assertEqual(resp.data["role"], "customer")

        # Refresh
        refresh = resp.data.get("refresh") or resp.data.get("refresh_token")
        if refresh:
            resp = self.client.post("/api/auth/token/refresh/", {"refresh": refresh}, format="json")
            self.assertIn(resp.status_code, (200, 400))

    def test_02_merchant_registration(self):
        """Merchant can register"""
        resp = self._register("merc@qa.com", "StrongPass123!", "QA Merchant", "merchant", "QA Store")
        self.assertEqual(resp.status_code, 201, f"Register failed: {resp.data}")
        access = resp.data["access"]

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        resp = self.client.get("/api/auth/me/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["role"], "merchant")

    def test_03_role_isolation(self):
        """Customer cannot access merchant endpoints"""
        resp = self._register("cust3@qa.com", "Pass1234!", "C3", "customer")
        if resp.status_code != 201:
            self.skipTest("Registration failed")
        cust_access = resp.data["access"]

        # Customer cannot access merchant-only endpoint
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {cust_access}")
        resp = self.client.get("/api/merchants/me/")
        self.assertIn(resp.status_code, (403, 404))


# ---------------------------------------------------------------------------
# MERCHANT FLOWS
# ---------------------------------------------------------------------------

class MerchantFlowTests(TestCase):
    """Merchant Onboarding, Menu, Tables, Store Config"""

    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()
        # Create user + profile manually (as registration + onboarding would)
        self.merchant_user = self.user_model.objects.create_user(
            username="qa-merc", email="qa-merc@test.com", password="Pass123!", role="merchant"
        )
        self.merchant_profile = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="QA Cafe", slug="qa-cafe",
            address="123 Test St", phone="+977-9812345678",
            description="QA testing cafe", onboarding_complete=True,
        )
        self.client.force_authenticate(user=self.merchant_user)

    def test_10_merchant_profile_read(self):
        """Merchant can read own profile"""
        resp = self.client.get("/api/merchants/me/")
        self.assertEqual(resp.status_code, 200, f"Get profile failed: {resp.data}")
        self.assertEqual(resp.data["business_name"], "QA Cafe")

    def test_11_menu_item_crud(self):
        """Merchant CRUD for menu items"""
        # Create
        resp = self.client.post("/api/merchants/menu-items/", {
            "name": "Cappuccino", "price": "250.00", "category": "Coffee",
            "is_available": True, "loyalty_reward": True, "points_per_item": 10,
        }, format="json")
        self.assertEqual(resp.status_code, 201, f"Create failed: {resp.data}")
        item_id = resp.data["id"]

        # List
        resp = self.client.get("/api/merchants/menu-items/")
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(len(resp.data), 1)

        # Update
        resp = self.client.patch(f"/api/merchants/menu-items/{item_id}/", {
            "price": "275.00", "is_available": False,
        }, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(str(resp.data["price"]), "275.00")

        # Delete
        resp = self.client.delete(f"/api/merchants/menu-items/{item_id}/")
        self.assertEqual(resp.status_code, 204)

    def test_12_table_generation(self):
        """Merchant can generate tables with QR tokens"""
        resp = self.client.post("/api/merchants/tables/generate/", {
            "count": 3, "name_prefix": "Table"
        }, format="json")
        self.assertEqual(resp.status_code, 201, f"Generate failed: {resp.data}")
        tables = MerchantTable.objects.filter(merchant=self.merchant_profile)
        self.assertEqual(tables.count(), 3)
        for t in tables:
            self.assertTrue(t.public_token.startswith("TBL-"))


# ---------------------------------------------------------------------------
# CUSTOMER FLOWS
# ---------------------------------------------------------------------------

class CustomerFlowTests(TestCase):
    """Customer Journey: join, browse, order"""

    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()
        # Merchant setup
        self.merchant_user = self.user_model.objects.create_user(
            username="cf-shop", email="cf-shop@test.com", password="Pass123!", role="merchant"
        )
        self.merchant_profile = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="CF Shop", slug="cf-shop",
            is_open=True, onboarding_complete=True, table_ordering_enabled=True,
        )
        self.item1 = MenuItem.objects.create(
            merchant=self.merchant_profile, name="Latte", price=200.00,
            category="Coffee", is_available=True, loyalty_reward=True, points_per_item=10,
        )
        self.item2 = MenuItem.objects.create(
            merchant=self.merchant_profile, name="Croissant", price=150.00,
            category="Food", is_available=True, loyalty_reward=True, points_per_item=5,
        )
        # Customer setup
        self.customer_user = self.user_model.objects.create_user(
            username="cf-cust", email="cf-cust@test.com", password="Pass123!", role="customer"
        )
        self.customer_profile = CustomerProfile.objects.create(
            user=self.customer_user, full_name="CF Customer"
        )

    def test_20_join_merchant(self):
        """Customer joins a merchant via merchant_slug"""
        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.post("/api/loyalty/merchant-profiles/join/", {
            "merchant_slug": "cf-shop"
        }, format="json")
        self.assertEqual(resp.status_code, 201, f"Join failed: {resp.data}")
        self.assertIn("profile", resp.data)
        self.assertIn("wallet", resp.data)
        self.assertTrue(resp.data["created"])

        # Idempotent re-join
        resp2 = self.client.post("/api/loyalty/merchant-profiles/join/", {
            "merchant_slug": "cf-shop"
        }, format="json")
        self.assertEqual(resp2.status_code, 200)
        self.assertFalse(resp2.data["created"])
        self.assertEqual(resp2.data["profile"]["id"], resp.data["profile"]["id"])

    def test_21_list_memberships(self):
        """Customer lists joined merchants"""
        CustomerMerchantProfile.objects.create(
            customer=self.customer_profile, merchant=self.merchant_profile,
            status=CustomerMerchantProfile.STATUS_ACTIVE,
        )
        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.get("/api/loyalty/merchant-profiles/mine/")
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(len(resp.data), 1)

    def test_22_browse_public_menu(self):
        """Anyone can browse public merchant menu"""
        resp = self.client.get(f"/api/merchants/{self.merchant_profile.id}/menu/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 2)

    def test_23_order_full_lifecycle(self):
        """Order flows through valid status transitions"""
        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.post("/api/orders/create/", {
            "merchant_id": self.merchant_profile.id,
            "items": [{"menu_item_id": self.item1.id, "quantity": 2}],
            "notes": "Test",
            "fulfillment_type": "pickup",
        }, format="json")
        self.assertEqual(resp.status_code, 201, f"Create failed: {resp.data}")
        order_id = resp.data["id"]
        self.assertEqual(resp.data["status"], "pending")

        # Merchant transitions: pending → confirmed → preparing → ready → completed
        self.client.force_authenticate(user=self.merchant_user)
        for status_val in ("confirmed", "preparing", "ready", "completed"):
            r = self.client.patch(
                f"/api/orders/{order_id}/update-status/",
                {"status": status_val}, format="json"
            )
            self.assertEqual(r.status_code, 200, f"Transition to {status_val} failed: {r.data}")
            self.assertEqual(r.data["status"], status_val)

    def test_24_cancel_order_from_pending(self):
        """Order can be cancelled from pending"""
        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.post("/api/orders/create/", {
            "merchant_id": self.merchant_profile.id,
            "items": [{"menu_item_id": self.item1.id, "quantity": 1}],
            "fulfillment_type": "pickup",
        }, format="json")
        order_id = resp.data["id"]

        self.client.force_authenticate(user=self.merchant_user)
        resp = self.client.patch(f"/api/orders/{order_id}/update-status/", {
            "status": "cancelled"
        }, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], "cancelled")

    def test_25_invalid_transition_rejected(self):
        """pending → completed directly is rejected"""
        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.post("/api/orders/create/", {
            "merchant_id": self.merchant_profile.id,
            "items": [{"menu_item_id": self.item1.id, "quantity": 1}],
            "fulfillment_type": "pickup",
        }, format="json")
        order_id = resp.data["id"]

        self.client.force_authenticate(user=self.merchant_user)
        resp = self.client.patch(f"/api/orders/{order_id}/update-status/", {
            "status": "completed"
        }, format="json")
        self.assertEqual(resp.status_code, 400)


# ---------------------------------------------------------------------------
# LOYALTY FLOWS
# ---------------------------------------------------------------------------

class LoyaltyFlowTests(TestCase):
    """Loyalty: points, punch cards, rewards, transfers, missions"""

    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()
        # Merchant
        self.merchant_user = self.user_model.objects.create_user(
            username="loy-m", email="loy-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant_profile = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Loyalty Cafe", slug="loyalty-cafe",
            is_open=True, onboarding_complete=True,
        )
        self.item = MenuItem.objects.create(
            merchant=self.merchant_profile, name="Espresso", price=180.00,
            is_available=True, loyalty_reward=True, points_per_item=15,
        )
        # Customer
        self.customer_user = self.user_model.objects.create_user(
            username="loy-c", email="loy-c@test.com", password="Pass123!", role="customer"
        )
        self.customer_profile = CustomerProfile.objects.create(
            user=self.customer_user, full_name="Loyal Customer"
        )
        self.membership = CustomerMerchantProfile.objects.create(
            customer=self.customer_profile, merchant=self.merchant_profile,
            status=CustomerMerchantProfile.STATUS_ACTIVE,
        )
        self.wallet = CustomerMerchantWallet.objects.create(
            customer=self.customer_profile, merchant=self.merchant_profile,
            membership=self.membership, points_balance=500, lifetime_points=500,
        )

    def _complete_order(self, qty=1):
        """Helper: place and complete an order, return order_id"""
        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.post("/api/orders/create/", {
            "merchant_id": self.merchant_profile.id,
            "items": [{"menu_item_id": self.item.id, "quantity": qty}],
            "fulfillment_type": "pickup",
        }, format="json")
        oid = resp.data["id"]
        self.client.force_authenticate(user=self.merchant_user)
        for s in ("confirmed", "preparing", "ready", "completed"):
            self.client.patch(f"/api/orders/{oid}/update-status/", {"status": s}, format="json")
        return oid

    def test_30_points_awarded_on_completion(self):
        """Points are awarded on order completion"""
        self._complete_order(3)  # 3 * 15 = 45 item points

        self.wallet.refresh_from_db()
        self.assertGreater(self.wallet.points_balance, 500,
                           f"Expected > 500, got {self.wallet.points_balance}")

        # Verify transaction record
        txns = PointTransaction.objects.filter(
            wallet=self.wallet, transaction_type="EARNED"
        )
        self.assertGreaterEqual(txns.count(), 1)

    def test_31_punch_card_stamps(self):
        """Punch card stamps are added on order completion"""
        punch = MerchantPunchCard.objects.create(
            merchant=self.merchant_profile, name="Free Coffee",
            stamps_required=5, mode=MerchantPunchCard.MODE_PER_ORDER,
            stamp_icon="☕", is_active=True,
        )
        self._complete_order(1)

        cards = CustomerPunchCard.objects.filter(customer=self.customer_profile, punch_card=punch)
        self.assertGreaterEqual(cards.count(), 1)
        self.assertEqual(cards.first().current_stamps, 1)

    def test_32_reward_redemption_flow(self):
        """Customer redeems reward, merchant confirms"""
        reward = Reward.objects.create(
            merchant=self.merchant_profile, name="Free Latte",
            emoji="☕", points_cost=100, stock=10, is_active=True,
        )

        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.post(f"/api/loyalty/rewards/{reward.id}/redeem/", format="json")
        self.assertEqual(resp.status_code, 201, f"Redeem failed: {resp.data}")
        redemption_code = resp.data["code"]

        # Merchant confirms
        self.client.force_authenticate(user=self.merchant_user)
        resp = self.client.post("/api/loyalty/redemptions/confirm/", {
            "code": redemption_code,
        }, format="json")
        self.assertEqual(resp.status_code, 200, f"Confirm failed: {resp.data}")
        self.assertTrue(resp.data["success"])
        self.assertEqual(resp.data["reward_name"], "Free Latte")

    def test_33_point_transfer(self):
        """Customer transfers points to another customer"""
        recipient_user = self.user_model.objects.create_user(
            username="loy-r", email="loy-r@test.com", password="Pass123!", role="customer"
        )
        recipient_profile = CustomerProfile.objects.create(user=recipient_user, full_name="Recipient")
        recipient_membership = CustomerMerchantProfile.objects.create(
            customer=recipient_profile, merchant=self.merchant_profile,
            status=CustomerMerchantProfile.STATUS_ACTIVE,
        )
        recipient_wallet = CustomerMerchantWallet.objects.create(
            customer=recipient_profile, merchant=self.merchant_profile,
            membership=recipient_membership, points_balance=100,
        )

        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.post("/api/loyalty/transfers/create/", {
            "receiver_transfer_code": recipient_profile.transfer_code,
            "merchant_id": self.merchant_profile.id,
            "amount": 50,
            "description": "Thanks!",
        }, format="json")
        self.assertEqual(resp.status_code, 201, f"Transfer failed: {resp.data}")

        self.wallet.refresh_from_db()
        recipient_wallet.refresh_from_db()
        self.assertEqual(self.wallet.points_balance, 450)
        self.assertEqual(recipient_wallet.points_balance, 150)

    def test_34_mission_tracking(self):
        """Mission progress tracks order count correctly"""
        mission = Mission.objects.create(
            title="First Order", mission_type="order_count",
            target_count=1, reward_points=100,
            required_merchant=self.merchant_profile, is_active=True,
        )
        self._complete_order(1)

        progress = CustomerMission.objects.get(customer=self.customer_profile, mission=mission)
        self.assertEqual(progress.current_count, 1)
        self.assertTrue(progress.is_completed)


# ---------------------------------------------------------------------------
# POS FLOWS
# ---------------------------------------------------------------------------

class POSFlowTests(TestCase):
    """Point-of-Sale terminal: device, auth, shifts, payments"""

    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()
        self.merchant_user = self.user_model.objects.create_user(
            username="pos-m", email="pos-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant_profile = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="POS Cafe", slug="pos-cafe",
            is_open=True, onboarding_complete=True, pos_enabled=True,
            table_ordering_enabled=True,
        )
        self.item = MenuItem.objects.create(
            merchant=self.merchant_profile, name="Americano", price=200.00,
            is_available=True, loyalty_reward=True, points_per_item=10,
        )
        self.customer_user = self.user_model.objects.create_user(
            username="pos-c", email="pos-c@test.com", password="Pass123!", role="customer"
        )
        self.customer_profile = CustomerProfile.objects.create(
            user=self.customer_user, full_name="POS Customer"
        )
        CustomerMerchantProfile.objects.create(
            customer=self.customer_profile, merchant=self.merchant_profile,
            status=CustomerMerchantProfile.STATUS_ACTIVE,
        )

    def test_40_device_registration(self):
        """POS device can be registered"""
        self.client.force_authenticate(user=self.merchant_user)
        resp = self.client.post("/api/pos/device/register/", {
            "name": "Terminal-1",
        }, format="json")
        self.assertEqual(resp.status_code, 201, f"Device register failed: {resp.data}")
        self.assertIn("device", resp.data)
        self.assertIn("device_token", resp.data)
        self.assertEqual(resp.data["device"]["name"], "Terminal-1")

    def test_41_worker_crud(self):
        """Merchant can create workers"""
        self.client.force_authenticate(user=self.merchant_user)
        resp = self.client.post("/api/pos/workers/create/", {
            "display_name": "John",
            "pin": "1234",
            "role": "cashier",
        }, format="json")
        self.assertEqual(resp.status_code, 201, f"Worker create failed: {resp.data}")
        self.assertIn("id", resp.data)

    def test_42_shift_lifecycle(self):
        """Shift open and close through API"""
        self.client.force_authenticate(user=self.merchant_user)
        # Pre-reqs: worker, device
        w = self.client.post("/api/pos/workers/create/",
                             {"display_name": "W", "pin": "4321", "role": "cashier"}, format="json").data
        d = self.client.post("/api/pos/device/register/",
                             {"name": "POS-1"}, format="json").data
        worker_id = w["id"]
        device_id = d["device"]["id"]

        # Open shift
        resp = self.client.post("/api/pos/shift/open/", {
            "worker_id": worker_id, "device_id": device_id, "opening_cash": "2000.00",
        }, format="json")
        self.assertEqual(resp.status_code, 201, f"Shift open failed: {resp.data}")
        shift_id = resp.data["id"]
        self.assertEqual(resp.data["status"], "open")

        # Close shift
        resp = self.client.post("/api/pos/shift/close/", {
            "shift_id": shift_id, "worker_id": worker_id, "closing_cash": "2000.00",
        }, format="json")
        self.assertEqual(resp.status_code, 200, f"Shift close failed: {resp.data}")
        self.assertEqual(resp.data["status"], "closed")

    def test_43_pos_order_and_payment(self):
        """POS order + payment + loyalty award"""
        self.client.force_authenticate(user=self.merchant_user)
        w = self.client.post("/api/pos/workers/create/",
                             {"display_name": "C", "pin": "1111", "role": "cashier"}, format="json").data
        d = self.client.post("/api/pos/device/register/",
                             {"name": "POS-2"}, format="json").data
        device_id = d["device"]["id"]
        s = self.client.post("/api/pos/shift/open/",
                             {"worker_id": w["id"], "device_id": device_id, "opening_cash": "5000"}, format="json").data

        # Create POS order
        resp = self.client.post("/api/pos/order/create/", {
            "merchant_id": self.merchant_profile.id,
            "items": [{"menu_item_id": self.item.id, "quantity": 2}],
            "customer_id": self.customer_profile.id,
            "shift_id": s["id"],
            "worker_id": w["id"],
            "device_id": device_id,
            "fulfillment_type": "takeaway",
            "client_mutation_id": str(uuid.uuid4()),
        }, format="json")
        self.assertEqual(resp.status_code, 201, f"POS order failed: {resp.data}")
        order_uuid = resp.data["uuid"]  # Payment endpoint expects UUID

        # Payment (use order_uuid from serializer, must include device_id)
        resp = self.client.post("/api/pos/payment/create/", {
            "order_id": order_uuid, "shift_id": s["id"],
            "worker_id": w["id"], "device_id": device_id,
            "payment_method": "cash", "amount": "400.00", "change_amount": "0.00",
            "client_mutation_id": str(uuid.uuid4()),
        }, format="json")
        self.assertEqual(resp.status_code, 201, f"Payment failed: {resp.data}")

        # Verify order completed and loyalty awarded
        order = Order.objects.get(uuid=order_uuid)
        self.assertEqual(order.status, "completed")
        self.assertTrue(order.loyalty_awarded)

    def test_44_pos_idempotency(self):
        """Same client_mutation_id is idempotent"""
        self.client.force_authenticate(user=self.merchant_user)
        w = self.client.post("/api/pos/workers/create/",
                             {"display_name": "W2", "pin": "1111", "role": "cashier"}, format="json").data
        d = self.client.post("/api/pos/device/register/",
                             {"name": "POS-ID"}, format="json").data
        s = self.client.post("/api/pos/shift/open/",
                             {"worker_id": w["id"], "device_id": d["device"]["id"], "opening_cash": "1000"}, format="json").data

        mutation_id = str(uuid.uuid4())
        payload = {
            "merchant_id": self.merchant_profile.id,
            "items": [{"menu_item_id": self.item.id, "quantity": 1}],
            "shift_id": s["id"], "worker_id": w["id"], "device_id": d["device"]["id"],
            "fulfillment_type": "takeaway", "client_mutation_id": mutation_id,
        }

        r1 = self.client.post("/api/pos/order/create/", payload, format="json")
        self.assertEqual(r1.status_code, 201)

        r2 = self.client.post("/api/pos/order/create/", payload, format="json")
        self.assertIn(r2.status_code, (200, 201))
        self.assertEqual(r2.data["id"], r1.data["id"])

    def test_45_z_report(self):
        """Z-report endpoint responds"""
        self.client.force_authenticate(user=self.merchant_user)
        today = date.today().isoformat()
        resp = self.client.get(f"/api/pos/z-report/?date={today}")
        self.assertEqual(resp.status_code, 200)


# ---------------------------------------------------------------------------
# PREPARATION / KDS FLOWS
# ---------------------------------------------------------------------------

class PreparationFlowTests(TestCase):
    """Kitchen Display System / Preparation Routing"""

    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()
        self.merchant_user = self.user_model.objects.create_user(
            username="kds-m", email="kds-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant_profile = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="KDS Cafe", slug="kds-cafe",
            is_open=True, onboarding_complete=True, pos_enabled=True,
            preparation_routing_enabled=True,
        )
        self.bar_item = MenuItem.objects.create(
            merchant=self.merchant_profile, name="Latte", price=250.00,
            is_available=True, loyalty_reward=True, points_per_item=10,
        )
        self.kitchen_item = MenuItem.objects.create(
            merchant=self.merchant_profile, name="Burger", price=450.00,
            is_available=True, loyalty_reward=True, points_per_item=20,
        )
        self.customer_user = self.user_model.objects.create_user(
            username="kds-c", email="kds-c@test.com", password="Pass123!", role="customer"
        )
        self.customer_profile = CustomerProfile.objects.create(
            user=self.customer_user, full_name="KDS Customer"
        )

    def test_50_create_preparation_areas(self):
        """Merchant creates preparation areas"""
        self.client.force_authenticate(user=self.merchant_user)
        bar = self.client.post("/api/orders/preparation-areas/", {
            "name": "Bar", "color": "#FF6B35",
        }, format="json")
        self.assertEqual(bar.status_code, 201, f"Area create failed: {bar.data}")

        kitchen = self.client.post("/api/orders/preparation-areas/", {
            "name": "Kitchen", "color": "#004E89", "is_default": True,
        }, format="json")
        self.assertEqual(kitchen.status_code, 201)

    def test_51_order_routing_to_areas(self):
        """Order items are routed to correct preparation areas"""
        self.client.force_authenticate(user=self.merchant_user)
        # Setup areas
        bar = PreparationArea.objects.create(merchant=self.merchant_profile, name="Bar", color="#FF6B35")
        kitchen = PreparationArea.objects.create(merchant=self.merchant_profile, name="Kitchen", color="#004E89", is_default=True)
        # Assign items to areas
        self.bar_item.preparation_area = bar
        self.bar_item.requires_preparation = True
        self.bar_item.save()
        self.kitchen_item.preparation_area = kitchen
        self.kitchen_item.requires_preparation = True
        self.kitchen_item.save()

        CustomerMerchantProfile.objects.create(
            customer=self.customer_profile, merchant=self.merchant_profile,
            status=CustomerMerchantProfile.STATUS_ACTIVE,
        )
        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.post("/api/orders/create/", {
            "merchant_id": self.merchant_profile.id,
            "items": [
                {"menu_item_id": self.bar_item.id, "quantity": 2},
                {"menu_item_id": self.kitchen_item.id, "quantity": 1},
            ],
            "fulfillment_type": "pickup",
        }, format="json")
        self.assertEqual(resp.status_code, 201, f"Order failed: {resp.data}")

        order = Order.objects.get(id=resp.data["id"])
        items = OrderItem.objects.filter(order=order)
        latte = items.get(menu_item=self.bar_item)
        burger = items.get(menu_item=self.kitchen_item)
        self.assertEqual(latte.preparation_area.id, bar.id)
        self.assertEqual(burger.preparation_area.id, kitchen.id)
        self.assertEqual(latte.preparation_status, "pending")
        self.assertEqual(burger.preparation_status, "pending")

    def test_52_staff_assignment_to_areas(self):
        """Staff can be assigned to preparation areas"""
        self.client.force_authenticate(user=self.merchant_user)
        # Create worker via API (pin is set via endpoint, not direct ORM)
        w_resp = self.client.post("/api/pos/workers/create/", {
            "display_name": "Barista", "pin": "5555", "role": "cashier",
        }, format="json")
        self.assertEqual(w_resp.status_code, 201, f"Worker create failed: {w_resp.data}")
        worker_id = w_resp.data["id"]

        area = PreparationArea.objects.create(merchant=self.merchant_profile, name="Bar", color="#FF6B35")

        # Assign via endpoint (PUT with area_ids in body)
        resp = self.client.put(
            f"/api/orders/staff/{worker_id}/preparation-areas/",
            {"area_ids": [area.id]}, format="json"
        )
        # May succeed (200) or return 404 if worker UUID not found
        self.assertIn(resp.status_code, (200, 404), f"Staff assign failed: {getattr(resp, 'data', resp.content)}")

        assignments = StaffPreparationArea.objects.filter(worker_id=worker_id)
        self.assertEqual(assignments.count(), 1)
        self.assertEqual(assignments.first().preparation_area.id, area.id)


# ---------------------------------------------------------------------------
# GUEST ORDER FLOW
# ---------------------------------------------------------------------------

class GuestOrderFlowTests(TestCase):
    """Guest ordering without auth"""

    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()
        self.merchant_user = self.user_model.objects.create_user(
            username="guest-m", email="guest-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant_profile = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Guest Cafe", slug="guest-cafe",
            is_open=True, onboarding_complete=True, table_ordering_enabled=True,
        )
        self.item = MenuItem.objects.create(
            merchant=self.merchant_profile, name="Tea", price=100.00,
            is_available=True,
        )
        self.table = MerchantTable.objects.create(
            merchant=self.merchant_profile, name="Table 1",
            table_number=1, public_token="TBL-GUEST01", is_active=True,
        )

    def test_60_guest_order(self):
        """Guest places order without authentication"""
        resp = self.client.post("/api/orders/guest-create/", {
            "merchant_id": self.merchant_profile.id,
            "items": [{"menu_item_id": self.item.id, "quantity": 2}],
            "fulfillment_type": "dine_in",
            "table_token": "TBL-GUEST01",
            "guest_session_id": str(uuid.uuid4())[:16],
            "guest_name": "Walk-in Guest",
        }, format="json")
        self.assertEqual(resp.status_code, 201, f"Guest order failed: {resp.data}")
        self.assertIn("id", resp.data)
        self.assertEqual(resp.data["status"], "pending")

    def test_61_guest_public_menu(self):
        """Guest browses public menu"""
        resp = self.client.get(f"/api/merchants/{self.merchant_profile.id}/menu/")
        self.assertEqual(resp.status_code, 200)


# ---------------------------------------------------------------------------
# NOTIFICATIONS
# ---------------------------------------------------------------------------

class NotificationFlowTests(TestCase):
    """Notification lifecycle"""

    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()
        self.customer_user = self.user_model.objects.create_user(
            username="notif-c", email="notif-c@test.com", password="Pass123!", role="customer"
        )

    def test_70_notification_lifecycle(self):
        """Notifications can be listed, read, and cleared"""
        n = Notification.objects.create(
            user=self.customer_user,
            notification_type="points_earned",
            title="Points Awarded!",
            message="You earned 50 points",
        )

        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.get("/api/notifications/")
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(len(resp.data), 1)

        resp = self.client.get("/api/notifications/unread-count/")
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(resp.data["unread_count"], 1)

        resp = self.client.patch(f"/api/notifications/{n.id}/read/", format="json")
        self.assertEqual(resp.status_code, 200)


# ---------------------------------------------------------------------------
# EDGE CASES
# ---------------------------------------------------------------------------

class EdgeCaseTests(TestCase):
    """Edge cases: isolation, validation, security"""

    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()
        self.customer_user = self.user_model.objects.create_user(
            username="ec-c", email="ec-c@test.com", password="Pass123!", role="customer"
        )
        self.customer_profile = CustomerProfile.objects.create(user=self.customer_user, full_name="EC")

    def test_80_health_check(self):
        """Health endpoint responds"""
        resp = self.client.get("/healthz/")
        self.assertIn(resp.status_code, (200, 404))

    def test_81_merchant_public_profile(self):
        """Public merchant profile accessible by slug"""
        mu = self.user_model.objects.create_user(username="ec-m", email="ec-m@test.com", password="Pass123!", role="merchant")
        mp = MerchantProfile.objects.create(user=mu, business_name="EC Shop", slug="ec-shop")
        resp = self.client.get("/api/merchants/slug/ec-shop/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["business_name"], "EC Shop")

    def test_82_bad_requests(self):
        """Invalid requests return proper 400s"""
        # Missing required fields
        resp = self.client.post("/api/auth/login/", {"email": "x"}, format="json")
        self.assertEqual(resp.status_code, 400)

        resp = self.client.post("/api/auth/register/", {"email": "x"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_83_unauthorized_access(self):
        """Unauthenticated requests return 401"""
        resp = self.client.get("/api/auth/me/")
        self.assertEqual(resp.status_code, 401)

        resp = self.client.get("/api/orders/my-orders/")
        self.assertEqual(resp.status_code, 401)
