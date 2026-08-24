"""
Idempotently create or update a Django superuser from environment variables.

Credentials are read ONLY from the environment — never hardcoded, never
logged. Safe to run on every deploy.

Required env vars:
    DJANGO_SUPERUSER_EMAIL
    DJANGO_SUPERUSER_PASSWORD

Optional env vars:
    DJANGO_SUPERUSER_USERNAME   (defaults to the email)

Usage:
    python manage.py ensure_superuser
"""

import os
import sys

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create or update a superuser from DJANGO_SUPERUSER_* env vars."

    def handle(self, *args, **options):
        User = get_user_model()

        email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "").strip()
        password = os.environ.get("DJANGO_SUPERUSER_PASSWORD", "")
        username = os.environ.get("DJANGO_SUPERUSER_USERNAME", "").strip() or email

        if not email or not password:
            self.stderr.write(
                "Error: DJANGO_SUPERUSER_EMAIL and DJANGO_SUPERUSER_PASSWORD "
                "must be set in the environment."
            )
            sys.exit(1)

        lookup = {"email__iexact": email}
        created = False

        user = User.objects.filter(**lookup).first()
        if user is None:
            user = User.objects.create(
                username=username,
                email=email,
                is_staff=True,
                is_superuser=True,
            )
            created = True
        else:
            user.is_staff = True
            user.is_superuser = True

        user.set_password(password)
        user.save()

        action = "Created" if created else "Updated"
        self.stdout.write(self.style.SUCCESS(f"{action} superuser: {email}"))
