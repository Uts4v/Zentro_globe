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

Payment QR uploads (bank / eSewa / Fonepay / Khalti codes):
- SVG is accepted, but only ever RASTERISED to PNG — never stored as markup
- active content and external references are rejected before rendering
- oversized rasters are downscaled (QRs are designed to be reduced) rather
  than refused, and a larger wire cap applies than for photos
"""

import io
import logging
import re

from django.core.exceptions import ValidationError

logger = logging.getLogger(__name__)

# ── Limits ─────────────────────────────────────────────────────────────────────
MAX_UPLOAD_BYTES = 5 * 1024 * 1024          # 5 MiB wire cap (matches settings)
MAX_IMAGE_DIMENSION = 4096                   # px per side
MAX_IMAGE_PIXELS = MAX_IMAGE_DIMENSION ** 2  # decompression-bomb guard
PDF_MAX_UPLOAD_BYTES = 10 * 1024 * 1024      # 10 MiB for menu PDFs

# Payment QRs: banks ship huge PNGs and vector exports, so the photo limits
# (which exist to bound re-encoding cost) are the wrong trade-off here.
QR_MAX_UPLOAD_BYTES = 12 * 1024 * 1024       # 12 MiB wire cap
QR_MAX_DIMENSION = 1600                      # px per side after rasterising
QR_MIN_DIMENSION = 256                       # below this a scan is unreliable

# Cap raster formats to the safe allow-list.
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
# Canonical server-side extension per re-encoded format.
_FORMAT_EXT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}

# Pillow is imported lazily: it ships an unsigned native DLL (`_imaging.pyd`),
# which Windows Smart App Control / WDAC policies may block (WinError 4551,
# "An Application Control policy has blocked this file"). Keeping it out of the
# module import path lets the app boot and non-image endpoints keep working on
# such machines; image uploads surface a clear error instead of a server 500.
_PIL = None


def _load_pil():
    """Import Pillow on first use; raise UploadValidationError if unavailable."""
    global _PIL
    if _PIL is None:
        try:
            import PIL  # noqa: F401  (package initialisation)
            from PIL import Image, ImageOps, UnidentifiedImageError
            # Pillow raises DecompressionBombError beyond this pixel count at
            # decode time.
            Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
        except ImportError as exc:
            raise UploadValidationError(
                "Image processing is unavailable on this server "
                "(Pillow could not be loaded)."
            ) from exc
        _PIL = (Image, ImageOps, UnidentifiedImageError)
    return _PIL


class UploadValidationError(ValidationError):
    """Raised when an upload does not satisfy the media policy."""

    def __str__(self) -> str:
        # Django renders a single-message ValidationError as ``['the message']``,
        # and that string is what the API hands back to the merchant's settings
        # screen verbatim. Flatten it so the reason is readable.
        return " ".join(self.messages)


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

    Image, ImageOps, UnidentifiedImageError = _load_pil()

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


# ── Payment QR ─────────────────────────────────────────────────────────────────

# An SVG that a bank hands a merchant is markup, so it has to be treated as
# hostile before it is handed to a renderer. These patterns are the ones that
# let SVG reach out of the document or execute.
_SVG_ACTIVE_CONTENT = re.compile(
    rb"<\s*(script|foreignObject|iframe|embed|object|audio|video|animate|set|handler)\b",
    re.IGNORECASE,
)
_SVG_EXTERNAL_REF = re.compile(
    rb"(?:xlink:)?href\s*=\s*[\"']\s*(?:https?:|//|data:text/html|file:)|@import|url\s*\(\s*[\"']?\s*(?:https?:|//|file:)",
    re.IGNORECASE,
)
# The <svg> start tag can sit well past an XML declaration + DOCTYPE + comments,
# so sniffing only the first 4 KiB misses large hand-edited files.
_SVG_ROOT = re.compile(rb"<\s*svg\b", re.IGNORECASE)


def _looks_like_svg(data: bytes) -> bool:
    """True when the bytes are an SVG document (sniffed, not trusted)."""
    if data[:5].lower() == b"<?xml" or data[:4].lower() == b"<svg":
        return bool(_SVG_ROOT.search(data[:65536]))
    return b"<svg" in data[:4096].lower()


def _reject_active_svg(data: bytes) -> None:
    if _SVG_ACTIVE_CONTENT.search(data):
        raise UploadValidationError(
            "This SVG contains active content and cannot be used as a payment QR. "
            "Export it as a PNG instead."
        )
    if _SVG_EXTERNAL_REF.search(data):
        raise UploadValidationError(
            "This SVG links to external files and cannot be used as a payment QR. "
            "Export it as a PNG instead."
        )


def rasterize_svg(data: bytes, *, max_dimension: int = QR_MAX_DIMENSION) -> bytes:
    """
    Render SVG markup to a flat PNG.

    SVG is never persisted: it is rasterised here and only the PNG bytes are
    returned, so nothing that could execute ever reaches an ``<img src>``.
    Rendering uses PyMuPDF, which is already a dependency and ships as a single
    self-contained binary (no system cairo to install, unlike cairosvg).
    """
    _reject_active_svg(data)

    try:
        import pymupdf
    except ImportError as exc:  # pragma: no cover - dependency is pinned
        raise UploadValidationError(
            "SVG payment QRs cannot be processed on this server. "
            "Please upload a PNG or JPEG version."
        ) from exc

    try:
        with pymupdf.open(stream=data, filetype="svg") as doc:
            if doc.page_count < 1:
                raise UploadValidationError("This SVG has no drawable content.")
            page = doc[0]
            rect = page.rect
            # 1pt == 1/72in. Scale the vector page up to ``max_dimension`` so the
            # dense module pattern survives the raster, but never upscale a
            # document that is already small enough.
            longest = max(rect.width, rect.height) or 1.0
            zoom = min(max_dimension / longest, 4.0)
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            png = pixmap.tobytes("png")
    except UploadValidationError:
        raise
    except Exception as exc:
        logger.warning("SVG rasterisation failure: %s", exc)
        raise UploadValidationError("This SVG could not be rendered. Export it as a PNG instead.")

    if not png:
        raise UploadValidationError("This SVG could not be rendered. Export it as a PNG instead.")
    return png


def _fit_qr_raster(data: bytes) -> tuple[bytes, str]:
    """Normalise a payment QR raster to a sane, scannable square-ish PNG."""
    Image, ImageOps, _ = _load_pil()

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Image.DecompressionBombError:
        # Bank exports are occasionally enormous. Decoding is refused rather
        # than risking memory exhaustion, so say so instead of blaming the file.
        raise UploadValidationError(
            "This image is too large to process safely. Resize it to 1600x1600px "
            "(or smaller) and try again."
        )
    except Exception as exc:
        logger.warning("Payment QR decode failure: %s", exc)
        raise UploadValidationError("This file could not be read as an image.")

    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "PA") else "RGB")

    width, height = img.size
    if width <= 0 or height <= 0:
        raise UploadValidationError("This image has invalid dimensions.")
    if width > QR_MAX_DIMENSION or height > QR_MAX_DIMENSION:
        # QRs are designed to be reduced, so scale down instead of refusing —
        # banks routinely export 3000px+ artwork. LANCZOS keeps the edges crisp.
        img.thumbnail((QR_MAX_DIMENSION, QR_MAX_DIMENSION), Image.LANCZOS)
        width, height = img.size

    if max(width, height) < QR_MIN_DIMENSION:
        raise UploadValidationError(
            f"Payment QR images need to be at least {QR_MIN_DIMENSION}px on their "
            f"longest side so they stay scannable (this one is {max(width, height)}px). "
            "Export it at a higher resolution."
        )

    # Flatten onto white: a transparent-background QR scans as nothing on the
    # light scanners most banking apps use, and the file shrinks for free.
    if img.mode == "RGBA":
        background = Image.new("RGB", img.size, "white")
        background.paste(img, mask=img.split()[-1])
        img = background
    else:
        img = img.convert("RGB")

    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue(), ".png"


def validate_payment_qr_upload(
    uploaded_file, *, max_bytes: int = QR_MAX_UPLOAD_BYTES
) -> tuple[bytes, str]:
    """
    Validate + sanitise a merchant's payment QR image.

    Unlike :func:`validate_image_upload` this accepts SVG (rasterised to PNG)
    and tolerates oversized rasters, because that is how banks distribute
    payment codes. Returns ``(png_bytes, ".png")`` - always a flat PNG.
    """
    if uploaded_file is None:
        raise UploadValidationError("No file provided.")

    data = uploaded_file.read(max_bytes + 1)
    if len(data) == 0:
        raise UploadValidationError("Empty file.")
    if len(data) > max_bytes:
        raise UploadValidationError(
            f"Payment QR images must be under {max_bytes // (1024 * 1024)} MB."
        )

    if _looks_like_svg(data):
        data = rasterize_svg(data)

    return _fit_qr_raster(data)


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