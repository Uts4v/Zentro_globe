// src/components/ImageUploader.tsx
// Reusable image upload component that handles: file picking, client-side
// optimization preview, upload, and error display — all in Zentro's design system.

import { useRef, useState, useId } from "react";
import { Upload, X, Loader2, ImageIcon, Check } from "lucide-react";
import { optimizeImage, formatBytes, type ImagePreset } from "@/lib/image-optimize";
import { uploadImage } from "@/lib/image-upload";

export interface ImageUploaderProps {
  /** Which optimization preset to apply. */
  preset: ImagePreset;
  /** Supabase Storage bucket name. */
  bucket: string;
  /** Full storage path, e.g. "abc123/logo.webp". */
  storagePath: string;
  /** Currently saved image URL — shown as initial preview. */
  currentUrl?: string | null;
  /** Called with the new public URL after a successful upload. */
  onUpload: (publicUrl: string) => void;
  /** Optional: called when the user clears the current image. */
  onClear?: () => void;
  /** Label shown above the upload zone. */
  label?: string;
  /** Short hint shown inside the zone. */
  hint?: string;
  /** Shape of the preview: "square" (default) or "circle" (for avatars). */
  shape?: "square" | "circle";
  /** Aspect ratio class for the drop zone, e.g. "aspect-square" or "aspect-video". */
  aspectClass?: string;
  /** Extra Tailwind classes on the root element. */
  className?: string;
  disabled?: boolean;
}

type Status = "idle" | "previewing" | "uploading" | "done" | "error";

export function ImageUploader({
  preset,
  bucket,
  storagePath,
  currentUrl,
  onUpload,
  onClear,
  label,
  hint,
  shape = "square",
  aspectClass = "aspect-square",
  className = "",
  disabled = false,
}: ImageUploaderProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [sizeInfo, setSizeInfo] = useState<{ original: number; final: number } | null>(null);

  /** The URL to show: live preview > current saved URL > nothing */
  const displayUrl = previewUrl ?? currentUrl ?? null;
  const isCircle = shape === "circle";

  async function handleFile(file: File) {
    setStatus("previewing");
    setErrorMsg("");
    setSizeInfo(null);

    let optimized;
    try {
      optimized = await optimizeImage(file, preset);
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message ?? "Could not process image.");
      return;
    }

    setPreviewUrl(optimized.previewUrl);
    setSizeInfo({ original: file.size, final: optimized.finalBytes });
    setStatus("uploading");

    try {
      const { publicUrl } = await uploadImage(file, preset, bucket, storagePath);
      setStatus("done");
      onUpload(publicUrl);
      // Keep preview showing — it matches what's now on the server
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message ?? "Upload failed. Please try again.");
      setPreviewUrl(null);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so the same file can be re-selected after an error
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleClear() {
    setPreviewUrl(null);
    setSizeInfo(null);
    setStatus("idle");
    setErrorMsg("");
    onClear?.();
  }

  const uploading = status === "uploading" || status === "previewing";
  const radiusCls = isCircle ? "rounded-full" : "rounded-2xl";

  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      )}

      {/* ── Drop / click zone ── */}
      <div
        className={`relative ${aspectClass} w-full overflow-hidden border-2 border-dashed transition-colors
          ${radiusCls}
          ${disabled ? "cursor-not-allowed opacity-50 border-border" : "cursor-pointer border-border hover:border-ink/40"}
          ${status === "error" ? "border-rose-400" : ""}
          ${status === "done" ? "border-emerald-400" : ""}
        `}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => !disabled && !uploading && inputRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => e.key === "Enter" && !disabled && !uploading && inputRef.current?.click()}
        aria-label={label ?? "Upload image"}
      >
        {/* Background image preview */}
        {displayUrl ? (
          <img
            src={displayUrl}
            alt="Preview"
            className={`h-full w-full object-cover ${radiusCls}`}
            onError={() => setPreviewUrl(null)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-mist p-4 text-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">{hint ?? "Click or drag to upload"}</p>
            <p className="text-[10px] text-muted-foreground/60">JPG · PNG · WebP · max 5 MB</p>
          </div>
        )}

        {/* Uploading overlay */}
        {uploading && (
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 ${radiusCls}`}
          >
            <Loader2 className="h-8 w-8 animate-spin text-white" />
            <p className="text-xs font-medium text-white">
              {status === "previewing" ? "Processing…" : "Uploading…"}
            </p>
          </div>
        )}

        {/* Done checkmark flash */}
        {status === "done" && (
          <div
            className={`absolute inset-0 flex items-center justify-center bg-black/30 ${radiusCls}`}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500">
              <Check className="h-5 w-5 text-white" />
            </span>
          </div>
        )}

        {/* Clear button — only when there's something to clear and not uploading */}
        {displayUrl && !uploading && !disabled && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition-opacity hover:bg-black/80"
            aria-label="Remove image"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── Hidden file input ── */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={handleInputChange}
        disabled={disabled || uploading}
      />

      {/* ── Status row ── */}
      <div className="flex items-center justify-between gap-2 min-h-[20px]">
        {status === "error" && errorMsg && <p className="text-xs text-rose-500">{errorMsg}</p>}

        {status === "done" && sizeInfo && (
          <p className="text-xs text-emerald-600">
            Saved · {formatBytes(sizeInfo.final)}
            {sizeInfo.final < sizeInfo.original && (
              <span className="ml-1 text-muted-foreground">
                (was {formatBytes(sizeInfo.original)})
              </span>
            )}
          </p>
        )}

        {/* Change button when image exists and idle/done */}
        {displayUrl && !uploading && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
          >
            <Upload className="h-3 w-3" /> Change
          </button>
        )}
      </div>
    </div>
  );
}
