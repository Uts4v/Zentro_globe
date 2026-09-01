"""
config/media_utils.py

Shared server-side media validation and sanitisation.

Every uploaded file is treated as UNTRUSTED:
- filename extension provides no authority
- client Content-Type provides no authority
- only the actual file bytes are used to decide anything

Image uploads:
- only JPEG / PNG / WEBP raster formats are accepted (SVG/HTML/GIF rejected)
- the bytes are sniffed with Pillow and must pass ``verify()``
- the image is decoded and RE-ENCODED server-side (never stored verbatim)
- pixel dimensions and decompression-bomb limits are enforced
- the stored filename + extension are generated on the server

PDF uploads:
- magic-byte (%PDF-) verification in addition to the MIME check
- byte-size cap
"""

import io
import logging

from django.core.exceptions import ValidationError
from PIL import Image, ImageOps, UnidentifiedImageError

logger = logging.getLogger(__name__)

# ── Limits ─────────────────────────────────────────────────────────────────────
MAX_UPLOAD_BYTES = 5 * 1024 * 1024          # 5 MiB wire cap (matches settings)
MAX_IMAGE_DIMENSION = 4096                   # px per side
MAX_IMAGE_PIXELS = MAX_IMAGE_DIMENSION ** 2  # decompression-bomb guard
PDF_MAX_UPLOAD_BYTES = 10 * 1024 * 1024      # 10 MiB for menu PDFs

# Cap raster formats to the safe allow-list.
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
# Canonical server-side extension per re-encoded format.
_FORMAT_EXT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}

# Pillow raises DecompressionBombError beyond this pixel count at decode time.
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


class UploadValidationError(ValidationError):
    """Raised when an upload does not satisfy the media policy."""


def _as_error(exc: Exception) -> str:
    return str(exc) or exc.__class__.__name__


def validate_image_upload(uploaded_file, *, max_bytes: int = MAX_UPLOAD_BYTES) -> tuple[bytes, str]:
    """
    Validate + sanitise an uploaded image.

    Returns ``(reencoded_bytes, canonical_extension)``.

    Raises ``UploadValidationError`` for anything that is not a safe,
    bounded JPEG/PNG/WEBP raster image.
    """
    if uploaded_file is None:
        raise UploadValidationError("No file provided.")

    data = uploaded_file.read(max_bytes + 1)
    if len(data) == 0:
        raise UploadValidationError("Empty file.")
    if len(data) > max_bytes:
        raise UploadValidationError("Image exceeds the size limit.")
    return sanitize_image_bytes(data)


def sanitize_image_bytes(data: bytes, *, max_dimension: int = MAX_IMAGE_DIMENSION) -> tuple[bytes, str]:
    """Validate + sanitise raw image bytes (re-encode pass)."""
    if data.startswith(b"<svg") or b"<svg" in data[:4096]:
        raise UploadValidationError("SVG uploads are not permitted.")

    detected = None
    try:
        probe = Image.open(io.BytesIO(data))
        detected = (probe.format or "").upper()
        probe.verify()
    except Image.DecompressionBombError as exc:
        raise UploadValidationError(f"Image exceeds the maximum pixel limit ({_as_error(exc)}).")
    except UnidentifiedImageError:
        raise UploadValidationError("File is not a recognised image.")
    except UploadValidationError:
        raise
    except Exception as exc:
        logger.warning("Image probe failure: %s", exc)
        raise UploadValidationError("File is not a valid image.")

    if detected not in ALLOWED_IMAGE_FORMATS:
        raise UploadValidationError(
            f"Unsupported image format '{detected}'. Only JPEG, PNG and WEBP are allowed."
        )

    # ``verify()`` invalidates the handle — reopen before decoding.
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Image.DecompressionBombError as exc:
        raise UploadValidationError(f"Image exceeds the maximum pixel limit ({_as_error(exc)}).")
    except UploadValidationError:
        raise
    except Exception as exc:
        logger.warning("Image decode failure: %s", exc)
        raise UploadValidationError("Image could not be decoded.")

    width, height = img.size
    if width <= 0 or height <= 0:
        raise UploadValidationError("Image has invalid dimensions.")
    if width > max_dimension or height > max_dimension:
        raise UploadValidationError(
            f"Image dimensions {width}x{height} exceed the allowed {max_dimension}x{max_dimension}px limit."
        )

    # Normalise orientation and colour mode, then re-encode.
    img = ImageOps.exif_transpose(img)
    if img.mode == "P":
        img = img.convert("RGBA" if img.info.get("transparency") is not None else "RGB")
    elif img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "PA") else "RGB")

    out = io.BytesIO()
    try:
        if detected == "JPEG":
            img.convert("RGB").save(
                out, format="JPEG", quality=88, optimize=True, progressive=True,
            )
        elif detected == "PNG":
            img.save(out, format="PNG", optimize=True)
        else:  # WEBP
            img.save(out, format="WEBP", quality=88, method=6)
    except Exception as exc:
        logger.warning("Image re-encode failure: %s", exc)
        raise UploadValidationError("Image could not be re-encoded.")

    return out.getvalue(), _FORMAT_EXT[detected]


def validate_pdf_upload(uploaded_file, *, max_bytes: int = PDF_MAX_UPLOAD_BYTES) -> bytes:
    """
    Validate an uploaded PDF by magic bytes (not just the Content-Type header).

    Returns the raw PDF bytes. Raises ``UploadValidationError`` otherwise.
    """
    if uploaded_file is None:
        raise UploadValidationError("No file provided.")

    data = uploaded_file.read(max_bytes + 1)
    if len(data) == 0:
        raise UploadValidationError("Empty file.")
    if len(data) > max_bytes:
        raise UploadValidationError("PDF exceeds the size limit.")

    header = data[:1024].strip().lstrip(b"\xef\xbb\xbf")
    if not header.startswith(b"%PDF-"):
        raise UploadValidationError("File is not a valid PDF.")
    return data