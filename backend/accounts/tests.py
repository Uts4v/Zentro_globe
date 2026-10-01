from django.urls import reverse
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from unittest.mock import patch
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

    def test_merchant_google_returns_503_without_store_name(self):
        resp = self.client.post(
            reverse("auth-google"),
            {"id_token": "not-a-real-token", "role": "merchant"},
            format="json",
        )
        self.assertEqual(resp.status_code, 503)
        self.assertIn("not configured", str(resp.data).lower())


@override_settings(GOOGLE_OAUTH_CLIENT_IDS=["test-client-id"])
class GoogleAuthFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    @patch("google.oauth2.id_token.verify_oauth2_token")
    def test_new_merchant_google_auth_without_store_name(self, mock_verify):
        mock_verify.return_value = {
            "aud": "test-client-id",
            "email": "newmerchant@example.com",
            "email_verified": True,
            "sub": "google-sub-123",
            "name": "Jane Doe",
            "picture": "https://example.com/avatar.png",
        }
        resp = self.client.post(
            reverse("auth-google"),
            {"id_token": "valid-token", "role": "merchant"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["role"], "merchant")
        user = User.objects.get(email="newmerchant@example.com")
        self.assertEqual(user.role, "merchant")
        self.assertTrue(hasattr(user, "merchant_profile"))
        self.assertEqual(user.merchant_profile.business_name, "Jane Doe's Store")

    @patch("google.oauth2.id_token.verify_oauth2_token")
    def test_existing_merchant_google_auth_login_without_store_name(self, mock_verify):
        from merchants.models import MerchantProfile
        user = User.objects.create_user(
            username="existingmerchant",
            email="existing@example.com",
            role="merchant",
        )
        MerchantProfile.objects.create(
            user=user,
            business_name="Custom Coffee Roastery",
            slug="custom-coffee-roastery",
        )
        mock_verify.return_value = {
            "aud": "test-client-id",
            "email": "existing@example.com",
            "email_verified": True,
            "sub": "google-sub-456",
            "name": "Coffee Master",
        }
        resp = self.client.post(
            reverse("auth-google"),
            {"id_token": "valid-token", "role": "merchant"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["role"], "merchant")
        user.refresh_from_db()
        self.assertEqual(user.google_sub, "google-sub-456")
        self.assertEqual(user.merchant_profile.business_name, "Custom Coffee Roastery")


class ChangePasswordTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="changer1",
            email="changer@example.com",
            password="OldPass123!",
            role="customer",
        )
        self.client.force_authenticate(self.user)

    def _post(self, **overrides):
        payload = {"old_password": "OldPass123!", "new_password": "BrandNew456!"}
        payload.update(overrides)
        return self.client.post(
            reverse("auth-change-password"), payload, format="json"
        )

    def test_change_password_succeeds(self):
        resp = self._post()
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("BrandNew456!"))
        self.assertFalse(self.user.check_password("OldPass123!"))

    def test_wrong_current_password_is_rejected(self):
        resp = self._post(old_password="WrongPass123!")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("incorrect", str(resp.data).lower())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("OldPass123!"))

    def test_short_password_is_rejected(self):
        resp = self._post(new_password="Sh0rt!")
        self.assertEqual(resp.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("OldPass123!"))

    def test_requires_authentication(self):
        self.client.force_authenticate(None)
        resp = self._post()
        self.assertIn(resp.status_code, (401, 403))

    def test_google_only_account_gets_no_usable_password_code(self):
        oauth_user = User.objects.create_user(
            username="oauthonly1",
            email="oauth@example.com",
            password=None,
            role="customer",
        )
        self.client.force_authenticate(oauth_user)
        resp = self._post()
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data.get("code"), "no_usable_password")

    def test_me_reports_has_usable_password(self):
        resp = self.client.get(reverse("auth-me"))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["has_usable_password"])

        oauth_user = User.objects.create_user(
            username="oauthonly2",
            email="oauth2@example.com",
            password=None,
            role="customer",
        )
        self.client.force_authenticate(oauth_user)
        resp = self.client.get(reverse("auth-me"))
        self.assertFalse(resp.data["has_usable_password"])
