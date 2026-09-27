/**
 * src/lib/image-upload.ts
 *
 * Image upload helpers — uploads to Django /api/media/upload/
 * Returns a stable public URL served by Django (or a CDN in production).
 *
 * Django side: add a simple FileField endpoint that saves to MEDIA_ROOT
 * and returns { url: "http://..." }. See backend/accounts/views.py upload_image.
 */

import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";
import { optimizeImage, type ImagePreset } from "@/lib/image-optimize";

export interface UploadResult {
  publicUrl: string;
  path: string;
}

/**
 * Optimize a File then upload it to Django's media endpoint.
 * Returns the permanent public URL.
 */
export async function uploadImage(
  file: File,
  preset: ImagePreset,
  _bucket: string,        // kept for API compat — not used with Django
  storagePath: string     // used as the filename hint
): Promise<UploadResult> {
  const { blob } = await optimizeImage(file, preset);

  const formData = new FormData();
  // Use just the filename portion as the upload name
  const filename = storagePath.replace(/\//g, "_") + ".webp";
  formData.append("file", blob, filename);

  const headers = authHeaders(false); // no Content-Type — let browser set multipart boundary
  delete (headers as any)["Content-Type"];

  const data = await djangoFetch<{ url: string }>(apiUrl("/media/upload/"), {
    method: "POST",
    headers,
    body: formData,
  });

  return { publicUrl: data.url, path: storagePath };
}

// ── Per-category helpers (same API surface as before) ─────────────────────────

export async function uploadMerchantLogo(file: File, merchantId: string): Promise<UploadResult> {
  return uploadImage(file, "logo", "merchant-images", `${merchantId}/logo`);
}

export async function uploadMerchantBanner(file: File, merchantId: string): Promise<UploadResult> {
  return uploadImage(file, "banner", "banner-images", `${merchantId}/banner`);
}

/** @deprecated Use {@link uploadPaymentQr} - it posts to the payment-QR endpoint. */
export async function uploadMerchantPaymentQr(file: File, merchantId: string): Promise<UploadResult> {
  return { publicUrl: await uploadPaymentQr(file), path: `${merchantId}/payment_qr` };
}

export async function uploadCustomerProfile(file: File, customerId: string): Promise<UploadResult> {
  return uploadImage(file, "profile", "customer-images", `${customerId}/profile`);
}

export async function uploadProductImage(file: File, merchantId: string, productId: string): Promise<UploadResult> {
  return uploadImage(file, "product", "product-images", `${merchantId}/${productId}`);
}

/**
 * Payment QRs are uploaded untouched.
 *
 * `uploadImage` resizes and re-encodes because it targets photos. A QR code is
 * a dense machine-readable pattern, so downscaling or resampling artefacts
 * make it unscannable at the counter. Django still sniffs the file with Pillow
 * and stores a clean raster, so nothing untrusted reaches `<img src>`.
 *
 * This posts to the payment-QR endpoint rather than the photo one, because
 * banks distribute QR codes as SVG (rejected for photos) and as very large
 * PNGs. The server rasterises SVG to a flat PNG and downscales oversized
 * artwork - a QR is designed to be reduced, so unlike a photo that is not a
 * reason to refuse the file.
 */

/** Wire cap mirrors the server's QR_MAX_UPLOAD_BYTES. */
const QR_MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const QR_ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/svg",
];

/**
 * Fail fast with an actionable message rather than a bare 400 from the server.
 * The server still validates everything - this only saves a round trip and
 * explains the fix.
 */
function preflightPaymentQr(file: File): void {
  const type = (file.type || "").toLowerCase();
  const isSvg =
    type === "image/svg+xml" ||
    type === "image/svg" ||
    /\.svg$/i.test(file.name || "");

  if (type && !QR_ACCEPTED_TYPES.includes(type) && !isSvg) {
    throw new Error(
      `"${file.name}" is a ${type.replace("image/", "").toUpperCase()} file. ` +
        "Payment QR codes must be a PNG, JPEG, WEBP or SVG image.",
    );
  }
  if (file.size > QR_MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. ` +
        `Payment QR images must be under ${QR_MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    );
  }
  if (file.size === 0) {
    throw new Error(`"${file.name}" is empty.`);
  }
}

export async function uploadPaymentQr(file: File): Promise<string> {
  preflightPaymentQr(file);

  const formData = new FormData();
  formData.append("file", file, file.name || "payment-qr.png");

  // No Content-Type: the browser has to set the multipart boundary itself.
  const headers = authHeaders(false);
  delete (headers as any)["Content-Type"];

  const data = await djangoFetch<{ url: string }>(apiUrl("/media/upload/payment-qr/"), {
    method: "POST",
    headers,
    body: formData,
  });
  return data.url;
}

// Kept for API compat — no-op with Django (no separate storage bucket to delete from)
export async function deleteImage(_bucket: string, _path: string): Promise<void> {}

export const BUCKETS = {
  merchant: "merchant-images",
  customer: "customer-images",
  product:  "product-images",
  banner:   "banner-images",
} as const;
