import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, ScanLine, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { menuApi, type MenuScanResult } from "@/lib/api";
import { Button } from "@/components/ui/button";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp,.pdf," + ACCEPTED_TYPES.join(",");
const MAX_BYTES = 10 * 1024 * 1024;

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function validate(file: File): string | null {
  const byExt = /\.(jpe?g|png|webp|pdf)$/i.test(file.name);
  if (!ACCEPTED_TYPES.includes(file.type) && !byExt) {
    return "Upload a JPG, PNG or WEBP photo, or a PDF.";
  }
  if (file.size > MAX_BYTES) return "File is too large. The limit is 10 MB.";
  return null;
}

function announce(result: MenuScanResult) {
  if (result.items_count === 0) {
    toast.info("No new items found — everything on this menu is already on yours.");
    return;
  }
  const extras: string[] = [];
  const options = [
    result.variants_count > 0 ? plural(result.variants_count, "size/variant option") : "",
    result.add_ons_count > 0 ? plural(result.add_ons_count, "add-on") : "",
  ].filter(Boolean);
  if (options.length) extras.push(`Includes ${options.join(" and ")}.`);
  if (result.duplicates_skipped > 0) {
    extras.push(`${plural(result.duplicates_skipped, "item")} already on your menu skipped.`);
  }
  if (result.rows_skipped > 0) {
    extras.push(`${plural(result.rows_skipped, "item")} without a readable price skipped.`);
  }
  toast.success(
    `Success! ${plural(result.items_count, "item")} and ${plural(
      result.categories_count,
      "category",
      "categories",
    )} added to your menu.`,
    extras.length ? { description: extras.join(" ") } : undefined,
  );
  if (result.truncated) {
    toast.warning(
      "This menu was too long to read in one go, so some items near the end may be missing. Scan the remaining pages separately.",
      { duration: 10000 },
    );
  }
}

export function MenuScannerDialog({
  open,
  onClose,
  onScanned,
}: {
  open: boolean;
  onClose: () => void;
  onScanned: () => void | Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setError("");
      setDragging(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || scanning) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, scanning, onClose]);

  if (!open) return null;

  function pick(next: File | undefined) {
    if (!next) return;
    const problem = validate(next);
    setError(problem ?? "");
    setFile(problem ? null : next);
  }

  async function handleScan() {
    if (!file || scanning) return;
    setScanning(true);
    setError("");
    try {
      const result = await menuApi.scanMenu(file);
      announce(result);
      await onScanned();
      onClose();
    } catch (e: unknown) {
      setError((e as { message?: string }).message || "Scanning failed. Please try again.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
      onClick={(e) => e.target === e.currentTarget && !scanning && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-scanner-dialog-title"
        className="glass-strong w-full max-w-lg rounded-t-3xl p-6 sm:rounded-3xl"
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 id="menu-scanner-dialog-title" className="font-display text-2xl text-foreground">
              AI Menu Scanner
            </h2>
            <p className="text-xs text-muted-foreground">
              Upload a photo or PDF of your menu. Items are added with their prices, sizes, add-ons,
              dietary tags, allergens and calories when the menu shows them.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={scanning}
            aria-label="Close dialog"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-mist text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {scanning ? (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-4 rounded-2xl border border-ember/30 bg-ember/5 px-6 py-10 text-center"
          >
            <div className="relative grid h-16 w-16 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-ember/20" />
              <span className="relative grid h-16 w-16 place-items-center rounded-full bg-ember/15 text-ember">
                <Sparkles className="h-7 w-7 animate-pulse" />
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Gemini is reading your menu and converting items...
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                This usually takes under a minute, but can take a few minutes when Gemini is busy.
                Keep this window open.
              </p>
            </div>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
              dragging ? "border-ember bg-ember/10" : "border-border hover:border-ember/40"
            }`}
          >
            {file ? (
              <>
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Selected menu"
                    className="max-h-40 rounded-xl object-contain"
                  />
                ) : (
                  <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ember/15 text-ember">
                    <FileText className="h-7 w-7" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(1)} MB · click to choose a different file
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-mist text-muted-foreground">
                  <Upload className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Drag & drop your menu here, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    JPG, PNG, WEBP or PDF · up to 10 MB
                  </p>
                </div>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={scanning}
            className="h-11 rounded-2xl"
          >
            Cancel
          </Button>
          <Button
            onClick={handleScan}
            disabled={!file || scanning}
            className="h-11 rounded-2xl px-5"
          >
            {scanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ScanLine className="h-4 w-4" />
            )}
            {scanning ? "Scanning…" : "Upload & Scan Menu"}
          </Button>
        </div>
      </div>
    </div>
  );
}
