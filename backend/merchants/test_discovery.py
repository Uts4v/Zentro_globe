"""
Discover / nearby feed and merchant map-location tests.

Covers the full location chain the Discover screen depends on:
merchant saves a pin → /api/merchants/nearby/ ranks by real distance from
the caller → results differ per caller location.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from merchants.models import MerchantProfile

# Reference points
THAMEL = (27.7149, 85.3123)  # Kathmandu
LAKESIDE = (28.2096, 83.9591)  # Pokhara, ~140 km west of Kathmandu
BIRATNAGAR = (26.4525, 87.2718)  # far from every café below


def _make_merchant(name, lat=None, lng=None, *, approved=True, is_open=True):
    user = get_user_model().objects.create_user(
        username=f"{name.lower().replace(' ', '-')}-owner",
        email=f"{name.lower().replace(' ', '-')}@test.com",
        password="Pass123!",
        role="merchant",
    )
    return MerchantProfile.objects.create(
        user=user,
        business_name=name,
        slug=name.lower().replace(" ", "-"),
        is_approved=approved,
        is_open=is_open,
        latitude=lat,
        longitude=lng,
    )


class NearbyDiscoveryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = reverse("merchant-nearby")
        # Kathmandu cafés
        self.mansara = _make_merchant("Mansara Cafe", "27.723101", "85.330658")  # ~2 km from Thamel
        self.omega = _make_merchant("Omega", "27.699104", "85.282769")  # ~3.5 km from Thamel
        self.thamel_corner = _make_merchant("Thamel Corner", "27.715500", "85.312900")  # ~70 m
        # Pokhara café
        self.lakeside = _make_merchant("Lakeside Brew", "28.209000", "83.959500")
        # Never shown: no pin, or not approved
        self.no_pin = _make_merchant("Cafeophilla")
        self.unapproved = _make_merchant("Pending Cafe", "27.714950", "85.312350", approved=False)

    def _get(self, lat, lng, **extra):
        return self.client.get(self.url, {"lat": lat, "lng": lng, **extra})

    def _names(self, response):
        return [m["business_name"] for m in response.data]

    def test_kathmandu_user_gets_kathmandu_cafes_nearest_first(self):
        res = self._get(*THAMEL)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self._names(res), ["Thamel Corner", "Mansara Cafe", "Omega"])
        distances = [m["distance_km"] for m in res.data]
        self.assertEqual(distances, sorted(distances))
        self.assertLess(distances[0], 0.2)
        self.assertAlmostEqual(distances[1], 2.0, delta=0.5)

    def test_pokhara_user_gets_only_pokhara_cafe(self):
        res = self._get(*LAKESIDE)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self._names(res), ["Lakeside Brew"])
        self.assertLess(res.data[0]["distance_km"], 0.1)

    def test_user_far_from_every_cafe_gets_empty_list_not_a_default(self):
        res = self._get(*BIRATNAGAR)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, [])

    def test_cafes_without_pin_or_approval_are_never_listed(self):
        for point in (THAMEL, LAKESIDE, BIRATNAGAR):
            names = self._names(self._get(*point))
            self.assertNotIn("Cafeophilla", names)
            self.assertNotIn("Pending Cafe", names)

    def test_radius_limits_results_and_is_capped(self):
        res = self._get(*THAMEL, radius_km="2.5")
        self.assertEqual(self._names(res), ["Thamel Corner", "Mansara Cafe"])

        # Pokhara is ~140 km away: out of reach even when asking for 500 km,
        # because the radius is capped at 100 km.
        res = self._get(*THAMEL, radius_km="500")
        self.assertNotIn("Lakeside Brew", self._names(res))

    def test_location_is_required_and_validated(self):
        self.assertEqual(self.client.get(self.url).status_code, 400)
        self.assertEqual(self.client.get(self.url, {"lat": "27.7"}).status_code, 400)
        self.assertEqual(self._get("abc", "85.3").status_code, 400)
        self.assertEqual(self._get("nan", "85.3").status_code, 400)
        self.assertEqual(self._get("95", "85.3").status_code, 400)
        self.assertEqual(self._get("27.7", "185").status_code, 400)
        self.assertEqual(self._get(*THAMEL, radius_km="0").status_code, 400)
        self.assertEqual(self._get(*THAMEL, radius_km="-5").status_code, 400)

    def test_response_shape(self):
        item = self._get(*THAMEL).data[0]
        self.assertEqual(
            set(item),
            {
                "id", "business_name", "slug", "business_type", "address", "phone",
                "logo_url", "is_open", "latitude", "longitude", "distance_km",
            },
        )

    def test_search_across_antimeridian(self):
        fiji = _make_merchant("Suva Roast", "-18.100000", "179.990000")
        res = self._get("-18.1", "-179.99")  # ~2 km east, across the date line
        self.assertEqual(self._names(res), [fiji.business_name])


class MerchantLocationSaveTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.merchant = _make_merchant("Pin Test Cafe")
        self.client.force_authenticate(user=self.merchant.user)
        self.update_url = reverse("merchant-update")
        self.me_url = reverse("merchant-me")

    def test_saved_location_persists_and_is_rounded(self):
        # Raw browser GPS values carry more precision than the column holds.
        res = self.client.patch(
            self.update_url,
            {"latitude": 27.71724567891, "longitude": 85.32401234567},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["latitude"], "27.717246")
        self.assertEqual(res.data["longitude"], "85.324012")

        # A fresh request (as after refresh / re-login) sees the same pin.
        me = self.client.get(self.me_url)
        self.assertEqual(me.data["latitude"], "27.717246")
        self.assertEqual(me.data["longitude"], "85.324012")

    def test_saved_location_drives_discover(self):
        nearby_url = reverse("merchant-nearby")
        self.assertEqual(self.client.get(nearby_url, {"lat": THAMEL[0], "lng": THAMEL[1]}).data, [])

        self.client.patch(
            self.update_url, {"latitude": "27.715000", "longitude": "85.313000"}, format="json"
        )
        res = self.client.get(nearby_url, {"lat": THAMEL[0], "lng": THAMEL[1]})
        self.assertEqual([m["id"] for m in res.data], [self.merchant.id])

        # Moving the pin to Pokhara moves the café out of Kathmandu's Discover.
        self.client.patch(
            self.update_url, {"latitude": "28.209000", "longitude": "83.959500"}, format="json"
        )
        self.assertEqual(self.client.get(nearby_url, {"lat": THAMEL[0], "lng": THAMEL[1]}).data, [])
        res = self.client.get(nearby_url, {"lat": LAKESIDE[0], "lng": LAKESIDE[1]})
        self.assertEqual([m["id"] for m in res.data], [self.merchant.id])

    def test_location_can_be_cleared(self):
        self.client.patch(
            self.update_url, {"latitude": "27.715000", "longitude": "85.313000"}, format="json"
        )
        res = self.client.patch(
            self.update_url, {"latitude": None, "longitude": None}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.merchant.refresh_from_db()
        self.assertIsNone(self.merchant.latitude)
        self.assertIsNone(self.merchant.longitude)

    def test_invalid_locations_are_rejected_without_saving(self):
        bad_payloads = [
            {"latitude": "91", "longitude": "85"},
            {"latitude": "27", "longitude": "-181"},
            {"latitude": "123456.1234567", "longitude": "85"},
            {"latitude": "27.7"},
            {"longitude": "85.3"},
            {"latitude": "27.7", "longitude": None},
            {"latitude": "north", "longitude": "85.3"},
        ]
        for payload in bad_payloads:
            with self.subTest(payload=payload):
                res = self.client.patch(self.update_url, payload, format="json")
                self.assertEqual(res.status_code, 400, res.data)
        self.merchant.refresh_from_db()
        self.assertIsNone(self.merchant.latitude)

    def test_other_fields_save_without_touching_location(self):
        self.client.patch(
            self.update_url, {"latitude": "27.715000", "longitude": "85.313000"}, format="json"
        )
        res = self.client.patch(self.update_url, {"description": "New blurb"}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["latitude"], "27.715000")
