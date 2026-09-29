"""
Voucher codes and QR tokens.

Human code: 8 random Crockford-base32 characters (no 0/O, 1/I/L confusion)
plus one check character, displayed as ``ZNT-8K4M-7QX2C``. Typos are caught
before a lookup ever reaches the database.

QR token: a separate 128-bit random token (``zentro://offer/<token>``). It
contains no ids and is looked up server-side, like MembershipQrToken.
"""

from __future__ import annotations

import re
import secrets

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_VALUE = {ch: i for i, ch in enumerate(ALPHABET)}
_ALIASES = str.maketrans({"O": "0", "I": "1", "L": "1"})
BODY_LENGTH = 8
PREFIX = "ZNT"
QR_PREFIX = "zentro://offer/"


def _check_char(body: str) -> str:
    # Odd weights are coprime with 32, so every single-character typo changes
    # the checksum and is caught.
    return ALPHABET[sum((2 * i + 1) * _VALUE[ch] for i, ch in enumerate(body)) % len(ALPHABET)]


def generate_code() -> str:
    body = "".join(secrets.choice(ALPHABET) for _ in range(BODY_LENGTH))
    return body + _check_char(body)


def generate_qr_token() -> str:
    return secrets.token_urlsafe(16)


def format_code(code: str) -> str:
    return f"{PREFIX}-{code[:4]}-{code[4:]}"


def normalize_code(raw: str) -> str | None:
    """A typed or pasted code in canonical stored form, or None if it cannot be valid."""
    text = re.sub(r"[^0-9A-Za-z]", "", raw or "").upper()
    if text.startswith(PREFIX) and len(text) == len(PREFIX) + BODY_LENGTH + 1:
        text = text[len(PREFIX):]
    text = text.translate(_ALIASES)
    if len(text) != BODY_LENGTH + 1 or any(ch not in _VALUE for ch in text):
        return None
    body, check = text[:-1], text[-1]
    return text if _check_char(body) == check else None


def parse_scan(raw: str) -> tuple[str, str] | None:
    """
    Interpret what a cashier scanned or typed: ``("token", t)`` for a QR,
    ``("code", c)`` for a voucher code, or None for anything else.
    """
    raw = (raw or "").strip()
    if not raw:
        return None
    if raw.startswith(QR_PREFIX):
        token = raw[len(QR_PREFIX):].strip("/")
        return ("token", token) if re.fullmatch(r"[A-Za-z0-9_\-]{16,40}", token) else None
    code = normalize_code(raw)
    if code:
        return ("code", code)
    if re.fullmatch(r"[A-Za-z0-9_\-]{20,40}", raw):
        return ("token", raw)
    return None
