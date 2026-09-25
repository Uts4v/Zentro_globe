// src/lib/image-optimize.ts
// Pure browser-side image optimization: resize → WebP → compress.
// No server, no external libs — just the Canvas API.

export type ImagePreset = "profile" | "logo" | "product" | "banner" | "qr";

interface PresetConfig {
  maxWidth: number;
  maxHeight: number;
  /** 0–1 WebP quality. We'll iterate down if still too large. */
  quality: number;
  /** Hard ceiling in bytes before we error (after compression). */
  maxBytes: number;
}

const PRESETS: Record<ImagePreset, PresetConfig> = {
  profile: { maxWidth: 300,  maxHeight: 300,  quality: 0.82, maxBytes: 150_000 },
  logo:    { maxWidth: 500,  maxHeight: 500,  quality: 0.82, maxBytes: 250_000 },
  product: { maxWidth: 800,  maxHeight: 800,  quality: 0.80, maxBytes: 300_000 },
  banner:  { maxWidth: 1200, maxHeight: 500,  quality: 0.78, maxBytes: 450_000 },
  // Payment QR codes must stay sharp enough to scan: bigger and near-lossless.
  qr:      { maxWidth: 1000, maxHeight: 1000, quality: 0.95, maxBytes: 900_000 },
};

/** Allowed input MIME types. */
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Maximum raw file size before we even try to process it. */
const MAX_RAW_BYTES = 5 * 1024 * 1024; // 5 MB

export interface OptimizeResult {
  blob: Blob;
  /** Data URL suitable for <img src> preview — generated cheaply from the same canvas. */
  previewUrl: string;
  originalBytes: number;
  finalBytes: number;
}

/**
 * Validate, resize, and compress a user-selected File to WebP.
 *
 * @example
 * const result = await optimizeImage(file, "product");
 * // result.blob   → upload to Supabase Storage
 * // result.previewUrl → show <img src={result.previewUrl} />
 */
export async function optimizeImage(
  file: File,
  preset: ImagePreset
): Promise<OptimizeResult> {
  // ── 1. Validate ──────────────────────────────────────────────────────────
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error(`Unsupported file type "${file.type}". Please upload a JPG, PNG, or WebP.`);
  }
  if (file.size > MAX_RAW_BYTES) {
    throw new Error(`File is ${(file.size / 1_048_576).toFixed(1)} MB. Maximum is 5 MB.`);
  }

  const cfg = PRESETS[preset];

  // ── 2. Decode the image ──────────────────────────────────────────────────
  const bitmap = await createImageBitmap(file);

  // ── 3. Calculate target dimensions (contain, no upscale) ─────────────────
  const { width: srcW, height: srcH } = bitmap;
  const scale = Math.min(
    1,                          // never upscale
    cfg.maxWidth  / srcW,
    cfg.maxHeight / srcH
  );
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);

  // ── 4. Draw onto OffscreenCanvas (falls back to regular Canvas) ──────────
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(dstW, dstH);
    ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  } else {
    canvas = document.createElement("canvas");
    (canvas as HTMLCanvasElement).width  = dstW;
    (canvas as HTMLCanvasElement).height = dstH;
    ctx = (canvas as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D;
  }

  ctx.drawImage(bitmap, 0, 0, dstW, dstH);
  bitmap.close();

  // ── 5. Encode to WebP, iterating quality down until small enough ─────────
  let quality = cfg.quality;
  let blob: Blob;

  for (let attempt = 0; attempt < 6; attempt++) {
    blob = await canvasToBlob(canvas, "image/webp", quality);
    if (blob.size <= cfg.maxBytes) break;
    quality = Math.max(0.40, quality - 0.08);
  }

  blob = blob!;

  // ── 6. Build a preview URL from the HTMLCanvasElement path ───────────────
  let previewUrl: string;
  if (canvas instanceof HTMLCanvasElement) {
    previewUrl = canvas.toDataURL("image/webp", quality);
  } else {
    // OffscreenCanvas → convert blob to object URL for preview
    previewUrl = URL.createObjectURL(blob);
  }

  return {
    blob,
    previewUrl,
    originalBytes: file.size,
    finalBytes: blob.size,
  };
}

/** Promisified canvas → Blob, works for both canvas types. */
function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number
): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
        type,
        quality
      );
    });
  }
  // OffscreenCanvas has a native convertToBlob
  return (canvas as OffscreenCanvas).convertToBlob({ type, quality });
}

/** Human-readable file size string, e.g. "128 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}