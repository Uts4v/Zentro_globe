from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import MerchantProfile, MerchantTable, MenuItem
from orders.models import DiningSession, KitchenOrderTicket, Order, OrderItem
from orders.services.dining import generate_next_kot_number, get_active_dining_session


class DiningConsolidationAndKOTTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        user_model = get_user_model()
        self.merchant_user = user_model.objects.create_user(
            username="test_merchant",
            email="merchant@test.com",
            password="Password123!",
            role="merchant",
        )
        self.customer_user = user_model.objects.create_user(
            username="test_customer",
            email="cust@test.com",
            password="Password123!",
            role="customer",
        )
        from accounts.models import CustomerProfile
        self.customer = CustomerProfile.objects.create(
            user=self.customer_user,
            full_name="Alice Smith",
        )

        self.merchant = MerchantProfile.objects.create(
            user=self.merchant_user,
            business_name="Zentro Bistro",
            slug="zentro-bistro",
            is_approved=True,
            is_open=True,
            table_ordering_enabled=True,
            tax_rate_percent=0,
        )

        self.table_10 = MerchantTable.objects.create(
            merchant=self.merchant,
            name="Table 10",
            table_number=10,
            public_token="tbl-tok-10",
            is_active=True,
        )

        self.burger = MenuItem.objects.create(
            merchant=self.merchant,
            name="Burger",
            price=100,
            is_available=True,
            status=MenuItem.STATUS_ACTIVE,
        )
        self.coke = MenuItem.objects.create(
            merchant=self.merchant,
            name="Coke",
            price=50,
            is_available=True,
            status=MenuItem.STATUS_ACTIVE,
        )
        self.fries = MenuItem.objects.create(
            merchant=self.merchant,
            name="Fries",
            price=40,
            is_available=True,
            status=MenuItem.STATUS_ACTIVE,
        )
        self.dessert = MenuItem.objects.create(
            merchant=self.merchant,
            name="Dessert",
            price=60,
            is_available=True,
            status=MenuItem.STATUS_ACTIVE,
        )

    def test_daily_sequential_kot_generation(self):
        """KOT numbers increment sequentially starting from 1."""
        kot1 = generate_next_kot_number(self.merchant)
        self.assertEqual(kot1, 1)

        # Create dummy order with KOT number
        order = Order.objects.create(
            merchant=self.merchant,
            kot_number=kot1,
            total_amount=Decimal("100.00"),
        )
        KitchenOrderTicket.objects.create(
            merchant=self.merchant,
            order=order,
            kot_number=kot1,
            table_name_snapshot="Table 10",
        )

        kot2 = generate_next_kot_number(self.merchant)
        self.assertEqual(kot2, 2)

    def test_guest_dine_in_initial_order_creates_kot_and_open_bill(self):
        """First guest order at Table 10 creates an open bill and KOT #1."""
        res = self.client.post(
            "/api/orders/guest-create/",
            data={
                "merchant_id": self.merchant.id,
                "table_token": self.table_10.public_token,
                "guest_session_id": "sess-guest-1",
                "guest_name": "Bob Guest",
                "items": [
                    {"menu_item_id": self.burger.id, "quantity": 1, "name": "Burger", "price": "100.00"},
                    {"menu_item_id": self.coke.id, "quantity": 1, "name": "Coke", "price": "50.00"},
                ],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        order_id = res.data["id"]
        self.assertEqual(Decimal(res.data["total_amount"]), Decimal("150.00"))

        order = Order.objects.get(id=order_id)
        self.assertTrue(order.is_bill)
        self.assertEqual(order.kot_number, 1)
        self.assertIsNotNone(order.dining_session)
        self.assertEqual(order.dining_session.status, DiningSession.STATUS_ACTIVE)
        self.assertEqual(order.dining_session.table, self.table_10)

        # Check KOT
        kots = list(order.kots.all())
        self.assertEqual(len(kots), 1)
        kot1 = kots[0]
        self.assertEqual(kot1.kot_number, 1)
        self.assertEqual(len(kot1.items_data), 2)
        self.assertEqual(kot1.items_data[0]["name"], "Burger")
        self.assertEqual(kot1.items_data[0]["quantity"], 1)
        self.assertEqual(kot1.items_data[1]["name"], "Coke")
        self.assertEqual(kot1.items_data[1]["quantity"], 1)

    def test_order_more_consolidates_into_same_open_bill_with_separate_kot(self):
        """
        When customer orders more during the same dining session:
        - Items attach to the existing open bill (total $150 -> $250).
        - A new KOT #2 is generated containing ONLY the new items (Fries & Dessert).
        - Merchant can print KOT #1 and KOT #2 separately.
        """
        # 1. Initial Order: Burger x 1, Coke x 1 = $150
        res1 = self.client.post(
            "/api/orders/guest-create/",
            data={
                "merchant_id": self.merchant.id,
                "table_token": self.table_10.public_token,
                "guest_session_id": "sess-guest-1",
                "guest_name": "Guest 1",
                "items": [
                    {"menu_item_id": self.burger.id, "quantity": 1, "name": "Burger", "price": "100.00"},
                    {"menu_item_id": self.coke.id, "quantity": 1, "name": "Coke", "price": "50.00"},
                ],
            },
            format="json",
        )
        self.assertEqual(res1.status_code, 201)
        bill_order_id = res1.data["id"]

        # 2. Customer clicks "Order More": Fries x 1, Dessert x 1 = $100
        res2 = self.client.post(
            "/api/orders/guest-create/",
            data={
                "merchant_id": self.merchant.id,
                "table_token": self.table_10.public_token,
                "guest_session_id": "sess-guest-1",
                "guest_name": "Guest 1",
                "items": [
                    {"menu_item_id": self.fries.id, "quantity": 1, "name": "Fries", "price": "40.00"},
                    {"menu_item_id": self.dessert.id, "quantity": 1, "name": "Dessert", "price": "60.00"},
                ],
            },
            format="json",
        )
        self.assertEqual(res2.status_code, 201)
        self.assertEqual(res2.data["id"], bill_order_id)  # Same bill!

        # Verify only 1 Order exists in the system
        self.assertEqual(Order.objects.filter(merchant=self.merchant).count(), 1)
        bill_order = Order.objects.get(id=bill_order_id)

        # Updated total is 150 + 40 + 60 = 250
        self.assertEqual(bill_order.total_amount, Decimal("250.00"))
        self.assertEqual(bill_order.items.count(), 4)

        # But 2 distinct KOT tickets exist
        kots = list(bill_order.kots.order_by("kot_number"))
        self.assertEqual(len(kots), 2)

        # KOT #1: Only Burger & Coke
        self.assertEqual(kots[0].kot_number, 1)
        self.assertEqual([i["name"] for i in kots[0].items_data], ["Burger", "Coke"])

        # KOT #2: Only Fries & Dessert
        self.assertEqual(kots[1].kot_number, 2)
        self.assertEqual([i["name"] for i in kots[1].items_data], ["Fries", "Dessert"])

    def test_multiple_devices_at_same_table_consolidate_into_same_bill(self):
        """Two different guests scanning the same table join the active dining bill."""
        # Device A orders Burger
        res_a = self.client.post(
            "/api/orders/guest-create/",
            data={
                "merchant_id": self.merchant.id,
                "table_token": self.table_10.public_token,
                "guest_session_id": "device-A",
                "guest_name": "Person A",
                "items": [{"menu_item_id": self.burger.id, "quantity": 1, "name": "Burger", "price": "100.00"}],
            },
            format="json",
        )
        bill_id = res_a.data["id"]

        # Device B orders Coke
        res_b = self.client.post(
            "/api/orders/guest-create/",
            data={
                "merchant_id": self.merchant.id,
                "table_token": self.table_10.public_token,
                "guest_session_id": "device-B",
                "guest_name": "Person B",
                "items": [{"menu_item_id": self.coke.id, "quantity": 1, "name": "Coke", "price": "50.00"}],
            },
            format="json",
        )
        self.assertEqual(res_b.data["id"], bill_id)

        bill = Order.objects.get(id=bill_id)
        self.assertEqual(bill.total_amount, Decimal("150.00"))
        self.assertEqual(bill.kots.count(), 2)

    def test_paid_bill_closes_dining_session_so_next_customer_gets_new_bill(self):
        """Once bill is paid, the table session is closed. A new scan starts fresh."""
        res1 = self.client.post(
            "/api/orders/guest-create/",
            data={
                "merchant_id": self.merchant.id,
                "table_token": self.table_10.public_token,
                "guest_session_id": "first-customer",
                "guest_name": "Customer 1",
                "items": [{"menu_item_id": self.burger.id, "quantity": 1, "name": "Burger", "price": "100.00"}],
            },
            format="json",
        )
        order1_id = res1.data["id"]
        order1 = Order.objects.get(id=order1_id)

        # Mark order1 as paid / completed
        order1.payment_status = "paid"
        order1.status = Order.STATUS_COMPLETED
        order1.save()

        # Check session is auto-closed
        active = get_active_dining_session(self.merchant, table=self.table_10)
        self.assertIsNone(active)

        # Next customer sits at Table 10 and places order
        res2 = self.client.post(
            "/api/orders/guest-create/",
            data={
                "merchant_id": self.merchant.id,
                "table_token": self.table_10.public_token,
                "guest_session_id": "second-customer",
                "guest_name": "Customer 2",
                "items": [{"menu_item_id": self.fries.id, "quantity": 2, "name": "Fries", "price": "40.00"}],
            },
            format="json",
        )
        order2_id = res2.data["id"]

        # Different bill!
        self.assertNotEqual(order1_id, order2_id)
        self.assertEqual(Order.objects.filter(merchant=self.merchant).count(), 2)

        order2 = Order.objects.get(id=order2_id)
        self.assertEqual(order2.total_amount, Decimal("80.00"))
        self.assertEqual(order2.kot_number, 2)  # Sequential KOT continues
        self.assertEqual(order2.kots.count(), 1)

    def test_customer_app_online_order_generates_kot(self):
        """Even customer app orders (pickup/delivery) generate a KOT so merchant can print."""
        self.client.force_authenticate(self.customer_user)
        res = self.client.post(
            "/api/orders/create/",
            data={
                "merchant_id": self.merchant.id,
                "fulfillment_type": "pickup",
                "items": [
                    {"menu_item_id": self.burger.id, "quantity": 2, "name": "Burger", "price": "100.00"},
                ],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        order = Order.objects.get(id=res.data["id"])
        self.assertIsNotNone(order.kot_number)
        self.assertEqual(order.kots.count(), 1)
        kot = order.kots.first()
        self.assertEqual(kot.kot_number, order.kot_number)
        self.assertEqual(len(kot.items_data), 1)
        self.assertEqual(kot.items_data[0]["name"], "Burger")
        self.assertEqual(kot.items_data[0]["quantity"], 2)
