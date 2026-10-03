// src/hooks/useImageUpload.ts
// Headless hook for image upload — use this when you need custom UI
// but still want the optimize → upload → URL pipeline.

import { useState, useCallback } from "react";
import { optimizeImage, formatBytes, type ImagePreset } from "@/lib/image-optimize";
import { uploadImage } from "@/lib/image-upload";

export type UploadState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "uploading"; previewUrl: string }
  | { status: "done"; previewUrl: string; publicUrl: string; savedBytes: number }
  | { status: "error"; error: string; previewUrl?: string };

interface UseImageUploadOptions {
  preset: ImagePreset;
  bucket: string;
  storagePath: string;
  onSuccess?: (publicUrl: string) => void;
}

interface UseImageUploadReturn {
  state: UploadState;
  upload: (file: File) => Promise<void>;
  reset: () => void;
  /** Pass to <input onChange> directly. */
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function useImageUpload({
  preset,
  bucket,
  storagePath,
  onSuccess,
}: UseImageUploadOptions): UseImageUploadReturn {
  const [state, setState] = useState<UploadState>({ status: "idle" });

  const upload = useCallback(
    async (file: File) => {
      setState({ status: "processing" });

      // Step 1: client-side optimize
      let optimized;
      try {
        optimized = await optimizeImage(file, preset);
      } catch (err: any) {
        setState({ status: "error", error: err.message ?? "Could not process image." });
        return;
      }

      setState({ status: "uploading", previewUrl: optimized.previewUrl });

      // Step 2: upload to Supabase
      try {
        const { publicUrl } = await uploadImage(file, preset, bucket, storagePath);
        setState({
          status: "done",
          previewUrl: optimized.previewUrl,
          publicUrl,
          savedBytes: file.size - optimized.finalBytes,
        });
        onSuccess?.(publicUrl);
      } catch (err: any) {
        setState({
          status: "error",
          error: err.message ?? "Upload failed. Please try again.",
          previewUrl: optimized.previewUrl,
        });
      }
    },
    [preset, bucket, storagePath, onSuccess],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) upload(file);
      e.target.value = ""; // allow re-selecting same file
    },
    [upload],
  );

  return { state, upload, reset, onInputChange };
}

// Re-export for convenience
export { formatBytes };
