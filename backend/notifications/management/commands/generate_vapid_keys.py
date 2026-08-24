# notifications/management/commands/generate_vapid_keys.py
import base64

from django.core.management.base import BaseCommand


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class Command(BaseCommand):
    help = "Generate VAPID keypair for Web Push. Add the output to backend/.env"

    def handle(self, *args, **options):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        priv = ec.generate_private_key(ec.SECP256R1())
        private_raw = priv.private_numbers().private_value.to_bytes(32, "big")
        public_point = priv.public_key().public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint,
        )

        self.stdout.write("Add these lines to backend/.env:\n")
        self.stdout.write(f"VAPID_PUBLIC_KEY={_b64(public_point)}")
        self.stdout.write(f"VAPID_PRIVATE_KEY={_b64(private_raw)}")
