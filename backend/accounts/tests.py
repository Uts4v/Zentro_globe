from django.urls import reverse
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import User, OtpCode
from .serializers import sign_phone_token


class RoleAwareLoginTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_customer_login_rejects_merchant_role_request(self):
        user = User.objects.create_user(
            username="customer1",
            email="customer@example.com",
            password="StrongPass123!",
            role="customer",
        )

        response = self.client.post(
            reverse("auth-login"),
            {"email": user.email, "password": "StrongPass123!", "role": "merchant"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("customer", str(response.data).lower())

    def test_merchant_login_rejects_customer_role_request(self):
        user = User.objects.create_user(
            username="merchant1",
            email="merchant@example.com",
            password="StrongPass123!",
            role="merchant",
        )

        response = self.client.post(
            reverse("auth-login"),
            {"email": user.email, "password": "StrongPass123!", "role": "customer"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("merchant", str(response.data).lower())


@override_settings(SMS_BACKEND="console", DEBUG=True)
class OtpFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_send_otp_returns_debug_code_in_dev(self):
        resp = self.client.post(
            reverse("auth-send-otp"),
            {"phone": "+15551234567", "purpose": "signup"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("debug_code", resp.data)

        otp = OtpCode.objects.get(identifier="+15551234567", purpose="signup")
        # Stored hash must never equal the plaintext code
        self.assertNotEqual(otp.code_hash, resp.data["debug_code"])

    def test_send_otp_normalizes_phone(self):
        resp = self.client.post(
            reverse("auth-send-otp"),
            {"phone": "15551234567", "purpose": "signup"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(OtpCode.objects.filter(identifier="+15551234567").exists())

    def test_send_otp_rejects_short_phone(self):
        resp = self.client.post(
            reverse("auth-send-otp"),
            {"phone": "123", "purpose": "signup"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_verify_otp_with_correct_code(self):
        sent = self.client.post(
            reverse("auth-send-otp"),
            {"phone": "+15551234567", "purpose": "signup"},
            format="json",
        )
        code = sent.data["debug_code"]
        resp = self.client.post(
            reverse("auth-verify-otp"),
            {"phone": "+15551234567", "code": code, "purpose": "signup"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["verified"])
        self.assertTrue(resp.data["phone_token"])
        # Single use
        otp = OtpCode.objects.get(identifier="+15551234567")
        self.assertTrue(otp.is_used)

    def test_verify_otp_rejects_wrong_code(self):
        self.client.post(
            reverse("auth-send-otp"),
            {"phone": "+15551234567", "purpose": "signup"},
            format="json",
        )
        resp = self.client.post(
            reverse("auth-verify-otp"),
            {"phone": "+15551234567", "code": "000000", "purpose": "signup"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        otp = OtpCode.objects.get(identifier="+15551234567")
        self.assertEqual(otp.attempts, 1)

    def test_customer_register_succeeds_without_phone_token(self):
        # OTP verification is optional for now — phone is stored unverified.
        resp = self.client.post(
            reverse("auth-register"),
            {
                "email": "newcust@example.com",
                "password": "StrongPass123!",
                "confirm_password": "StrongPass123!",
                "full_name": "Maya Rivera",
                "role": "customer",
                "phone": "+15551234567",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        user = User.objects.get(email="newcust@example.com")
        self.assertEqual(user.phone, "+15551234567")
        self.assertFalse(user.phone_verified)

    def test_customer_register_succeeds_without_phone(self):
        resp = self.client.post(
            reverse("auth-register"),
            {
                "email": "nophone@example.com",
                "password": "StrongPass123!",
                "confirm_password": "StrongPass123!",
                "full_name": "No Phone",
                "role": "customer",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        user = User.objects.get(email="nophone@example.com")
        self.assertEqual(user.phone, "")
        self.assertFalse(user.phone_verified)

    def test_customer_register_succeeds_with_phone_token(self):
        token = sign_phone_token("+15551234567", purpose="signup")
        resp = self.client.post(
            reverse("auth-register"),
            {
                "email": "newcust@example.com",
                "password": "StrongPass123!",
                "confirm_password": "StrongPass123!",
                "full_name": "Maya Rivera",
                "role": "customer",
                "phone": "+15551234567",
                "phone_token": token,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["role"], "customer")
        user = User.objects.get(email="newcust@example.com")
        self.assertEqual(user.phone, "+15551234567")
        self.assertTrue(user.phone_verified)

    def test_customer_register_rejects_mismatched_phone_token(self):
        token = sign_phone_token("+15559998888", purpose="signup")
        resp = self.client.post(
            reverse("auth-register"),
            {
                "email": "newcust@example.com",
                "password": "StrongPass123!",
                "confirm_password": "StrongPass123!",
                "full_name": "Maya Rivera",
                "role": "customer",
                "phone": "+15551234567",
                "phone_token": token,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_merchant_register_does_not_require_phone(self):
        resp = self.client.post(
            reverse("auth-register"),
            {
                "email": "traderv2@example.com",
                "password": "StrongPass123!",
                "confirm_password": "StrongPass123!",
                "full_name": "Sam Trader",
                "role": "merchant",
                "store_name": "Sam's Roast",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)


@override_settings(GOOGLE_OAUTH_CLIENT_IDS=[])
class GoogleAuthConfigTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_google_returns_503_when_not_configured(self):
        resp = self.client.post(
            reverse("auth-google"),
            {"id_token": "not-a-real-token", "role": "customer"},
            format="json",
        )
        self.assertEqual(resp.status_code, 503)
        self.assertIn("not configured", str(resp.data).lower())
