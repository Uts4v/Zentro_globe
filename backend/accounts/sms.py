"""
accounts/sms.py

SMS gateway abstraction for OTP delivery.

Backends are selected with the SMS_BACKEND setting:

- "console"  (default, free): prints the code to server logs. Used for local
             dev. When DEBUG=True the OTP is also returned in the API response
             so the frontend can surface it for quick testing.
- "twilio"   : Twilio Verify (or Sms outbound). Needs TWILIO_ACCOUNT_SID,
             TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID (or
             TWILIO_PHONE_NUMBER).
- "vonage"   : Vonage/Nexmo SMS. Needs VONAGE_API_KEY, VONAGE_API_SECRET,
             VONAGE_BRAND (sender name, e.g. "Zentro").

Sending international SMS always costs money per message (roughly
$0.04–$0.12 depending on the destination country; India is much cheaper).
Twilio Verify is the easiest to keep compliant (US A2P 10DLC etc.).
"""

import logging
import re
from urllib.parse import urlencode

import requests
from django.conf import settings

logger = logging.getLogger("accounts.sms")

SMS_BACKEND_CONSOLE = "console"
SMS_BACKEND_TWILIO = "twilio"
SMS_BACKEND_VONAGE = "vonage"

_SMS_ROOT = "https://api.twilio.com/2010-04-01/Accounts"
_VONAGE_SMS_URL = "https://rest.nexmo.com/sms/json"


def get_sms_backend() -> str:
    return (settings.SMS_BACKEND or SMS_BACKEND_CONSOLE).lower()


def normalize_phone(value: str) -> str:
    """
    Light-touch phone normalisation: strip spaces/dashes/parens and ensure a
    leading "+" for E.164-ish storage. Keeps digits + leading plus.
    """
    cleaned = "".join(ch for ch in value.strip() if ch.isdigit() or ch in ("+",))
    if not cleaned:
        raise ValueError("Phone number is empty.")
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    elif not cleaned.startswith("+"):
        cleaned = "+" + cleaned
    # Sanity check: E.164 numbers are at most 15 digits (without the +).
    if len(cleaned) - 1 < 7 or len(cleaned) - 1 > 15:
        raise ValueError("Phone number must be between 7 and 15 digits (with country code).")
    return cleaned


def send_sms(phone: str, message: str) -> dict:
    """
    Send an SMS. Returns a dict with at least {"sent": bool, "channel": backend}
    and — for the console backend — the debug_code when DEBUG is on.
    """
    backend = get_sms_backend()
    if backend == SMS_BACKEND_TWILIO:
        return _send_twilio(phone, message)
    if backend == SMS_BACKEND_VONAGE:
        return _send_vonage(phone, message)
    return _send_console(phone, message)


def _send_console(phone: str, message: str) -> dict:
    # Extract a possible "[CODE]" tag for dev UX — keep it simple and just log.
    logger.info("[SMS][console] To=%s | %s", phone, message)
    result = {"sent": True, "channel": SMS_BACKEND_CONSOLE}
    if getattr(settings, "DEBUG", False):
        # Surface the code in the API response in dev only.
        match = re.search(r"\b(\d{%d})\b" % getattr(settings, "OTP_LENGTH", 6), message)
        if match:
            result["debug_code"] = match.group(1)
    return result


def _send_twilio(phone: str, message: str) -> dict:
    sid = getattr(settings, "TWILIO_ACCOUNT_SID", "")
    token = getattr(settings, "TWILIO_AUTH_TOKEN", "")
    from_number = (
        getattr(settings, "TWILIO_MESSAGING_SERVICE_SID", "")
        or getattr(settings, "TWILIO_PHONE_NUMBER", "")
    )
    if not (sid and token and from_number):
        raise RuntimeError(
            "SMS backend is 'twilio' but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN "
            "/ TWILIO_MESSAGING_SERVICE_SID (or TWILIO_PHONE_NUMBER) are unset."
        )

    payload = {
        "To": phone,
        "From": from_number,
        "Body": message,
    }
    resp = requests.post(
        f"{_SMS_ROOT}/{sid}/Messages.json",
        data=payload,
        auth=(sid, token),
        timeout=10,
    )
    resp.raise_for_status()
    return {"sent": True, "channel": SMS_BACKEND_TWILIO, "sid": resp.json().get("sid")}


def _send_vonage(phone: str, message: str) -> dict:
    api_key = getattr(settings, "VONAGE_API_KEY", "")
    api_secret = getattr(settings, "VONAGE_API_SECRET", "")
    brand = getattr(settings, "VONAGE_BRAND", "Zentro")[:11]
    if not (api_key and api_secret):
        raise RuntimeError(
            "SMS backend is 'vonage' but VONAGE_API_KEY / VONAGE_API_SECRET are unset."
        )

    payload = urlencode(
        {
            "api_key": api_key,
            "api_secret": api_secret,
            "from": brand,
            "to": phone.replace("+", ""),
            "text": message,
        }
    )
    resp = requests.post(_VONAGE_SMS_URL, data=payload, timeout=10)
    resp.raise_for_status()
    data = resp.json().get("messages", [{}])[0]
    if data.get("status") != "0":
        raise RuntimeError(f"Vonage SMS failed: {data.get('error-text')}")
    return {"sent": True, "channel": SMS_BACKEND_VONAGE, "msgid": data.get("message-id")}


def build_otp_message(code: str) -> str:
    return f"Your Zentro verification code is {code}. It expires in 10 minutes."