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

export async function uploadMerchantPaymentQr(file: File, merchantId: string): Promise<UploadResult> {
  return uploadImage(file, "qr", "merchant-images", `${merchantId}/payment_qr`);
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
 */
export async function uploadPaymentQr(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file, file.name || "payment-qr.png");

  // No Content-Type: the browser has to set the multipart boundary itself.
  const headers = authHeaders(false);
  delete (headers as any)["Content-Type"];

  const data = await djangoFetch<{ url: string }>(apiUrl("/media/upload/"), {
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
