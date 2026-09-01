"""
C-1 regression tests — upload hardening.

Run with: python manage.py test accounts.test_media_upload

Verifies that uploaded files are treated as untrusted:
- only real JPEG/PNG/WEBP raster images are accepted
- spoofed SVG/HTML is rejected regardless of filename or content type
- oversized / malformed images are rejected
- stored media is served with safety headers
"""

import io
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from PIL import Image

from rest_framework.test import APIClient
from rest_framework import status


def _png_bytes(size=(1, 1)):
    buf = io.BytesIO()
    Image.new("RGBA", size, (10, 20, 30, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _jpg_bytes(size=(1, 1)):
    buf = io.BytesIO()
    Image.new("RGB", size, (10, 20, 30)).save(buf, format="JPEG")
    return buf.getvalue()


def _webp_bytes(size=(1, 1)):
    buf = io.BytesIO()
    Image.new("RGBA", size, (10, 20, 30, 255)).save(buf, format="WEBP")
    return buf.getvalue()


def _svg_bytes():
    return b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


class UploadImageTests(TestCase):
    def setUp(self):
        self._media = tempfile.mkdtemp(prefix="zentro_test_media_")
        self._override = override_settings(MEDIA_ROOT=self._media)
        self._override.enable()
        self.addCleanup(self._override.disable)
        self.addCleanup(lambda: shutil.rmtree(self._media, ignore_errors=True))

        User = get_user_model()
        self.user = User.objects.create_user(
            username="uploader", email="uploader@test.com", password="Pass123!",
            role="customer",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _upload(self, data, name="file.png", content_type="image/png"):
        return self.client.post(
            "/api/media/upload/",
            data={"file": (io.BytesIO(data), name, content_type)},
            format="multipart",
        )

    def test_valid_png_accepted(self):
        resp = self._upload(_png_bytes(), name="photo.png", content_type="image/png")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertIn("/media/uploads/", resp.data["url"])
        self.assertTrue(resp.data["url"].endswith(".png"))

    def test_valid_jpg_accepted(self):
        resp = self._upload(_jpg_bytes(), name="photo.jpg", content_type="image/jpeg")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertTrue(resp.data["url"].endswith(".jpg"))

    def test_valid_webp_accepted(self):
        resp = self._upload(_webp_bytes(), name="photo.webp", content_type="image/webp")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertTrue(resp.data["url"].endswith(".webp"))

    def test_spoofed_svg_pretending_to_be_png_rejected(self):
        resp = self._upload(
            _svg_bytes(), name="image.png", content_type="image/png",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("error", resp.data)

    def test_spoofed_svg_claimed_jpeg_rejected(self):
        resp = self._upload(
            _svg_bytes(), name="image.jpg", content_type="image/jpeg",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_html_renamed_png_rejected(self):
        html = b"<html><body><script>alert(1)</script></body></html>"
        resp = self._upload(html, name="normal.png", content_type="image/png")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_malformed_image_rejected(self):
        resp = self._upload(b"not an image at all", name="x.png", content_type="image/png")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_oversized_image_rejected(self):
        # 5000x5000 PNG exceeds the 4096px dimension limit.
        buf = io.BytesIO()
        Image.new("RGB", (5000, 5000), (1, 1, 1)).save(buf, format="PNG", compress_level=9)
        resp = self._upload(
            buf.getvalue(), name="huge.png", content_type="image/png",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_stored_media_served_with_safety_headers(self):
        resp = self._upload(_png_bytes(), name="photo.png", content_type="image/png")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        media_resp = self.client.get(resp.data["url"])
        self.assertEqual(media_resp.status_code, 200)
        self.assertEqual(media_resp["X-Content-Type-Options"], "nosniff")
        self.assertIn("Content-Security-Policy", media_resp)

    def test_traversal_is_blocked_when_serving_media(self):
        resp = self.client.get("/media/../../etc/passwd")
        self.assertEqual(resp.status_code, 404)

    def test_requires_authentication(self):
        anon = APIClient()
        resp = anon.post(
            "/api/media/upload/",
            data={"file": (io.BytesIO(_png_bytes()), "photo.png", "image/png")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)