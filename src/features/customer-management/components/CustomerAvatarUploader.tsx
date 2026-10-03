/**
 * src/components/CustomerAvatarUploader.tsx
 *
 * Avatar uploader for the customer profile page.
 * Persists the new URL to Django PATCH /api/auth/me/.
 */

import { useState } from "react";
import { ImageUploader } from "@/components/image-uploader";
import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";
import { Loader2 } from "lucide-react";

interface CustomerAvatarUploaderProps {
  customerId: string;
  currentUrl?: string | null;
  onSaved?: (url: string) => void;
  disabled?: boolean;
}

export function CustomerAvatarUploader({
  customerId,
  currentUrl,
  onSaved,
  disabled,
}: CustomerAvatarUploaderProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function handleUpload(publicUrl: string) {
    setSaving(true);
    setSaveError("");
    try {
      await djangoFetch(apiUrl("/auth/me/"), {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify({ avatar_url: publicUrl }),
      });
      onSaved?.(publicUrl);
    } catch (err: any) {
      setSaveError(err.message ?? "Failed to save avatar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    try {
      await djangoFetch(apiUrl("/auth/me/"), {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify({ avatar_url: "" }),
      });
      onSaved?.("");
    } catch {
      /* best-effort */
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-5">
        <div className="w-24 shrink-0">
          <ImageUploader
            preset="profile"
            bucket="customer-images"
            storagePath={`${customerId}/profile.webp`}
            currentUrl={currentUrl}
            onUpload={handleUpload}
            onClear={handleClear}
            shape="circle"
            aspectClass="aspect-square"
            hint=""
            disabled={disabled || saving}
          />
        </div>
        <div>
          <p className="text-sm font-medium text-ink">Profile photo</p>
          <p className="mt-0.5 text-xs text-muted-foreground">JPG, PNG, or WebP · max 5 MB</p>
          {saving && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </p>
          )}
          {saveError && <p className="mt-1 text-xs text-rose-500">{saveError}</p>}
        </div>
      </div>
    </div>
  );
}
