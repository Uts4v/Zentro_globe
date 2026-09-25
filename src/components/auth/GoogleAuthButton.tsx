// src/components/auth/GoogleAuthButton.tsx
// "Continue with Google" — Google Identity Services (GIS).
// Uses Google's official rendered button overlay to guarantee reliable, popup-based
// OAuth sign-in across all browsers without One Tap FedCM suppression or cooldowns.
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string; error?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          prompt: (listener?: (notification: unknown) => void) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              logo_alignment?: "left" | "center";
              width?: number | string;
              click_listener?: () => void;
            }
          ) => void;
        };
      };
    };
  }
}

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || "";

let gsiPromise: Promise<void> | null = null;

function loadGsi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google sign-in."));
    document.head.appendChild(s);
  });
  return gsiPromise;
}

export function GoogleAuthButton({
  onToken,
  onError,
  label = "Continue with Google",
  className = "",
}: {
  onToken: (idToken: string) => void;
  onError?: (message: string) => void;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef<
    ((response: { credential?: string; error?: string }) => void) | undefined
  >(undefined);

  callbackRef.current = (response) => {
    setBusy(false);
    if (response.credential) {
      onToken(response.credential);
    } else if (onError) {
      onError(response.error || "Google sign-in was cancelled.");
    }
  };

  useEffect(() => {
    if (!CLIENT_ID) return;
    let isMounted = true;

    loadGsi()
      .then(() => {
        if (!isMounted || !window.google?.accounts?.id) return;
        const google = window.google;

        google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => callbackRef.current?.(response),
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        if (overlayRef.current) {
          overlayRef.current.innerHTML = "";
          google.accounts.id.renderButton(overlayRef.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "pill",
            width: 380,
            click_listener: () => {
              setBusy(true);
            },
          });
        }
      })
      .catch((e) => {
        if (isMounted) {
          onError?.(e instanceof Error ? e.message : "Failed to load Google sign-in.");
        }
      });

    return () => {
      isMounted = false;
      setBusy(false);
    };
  }, [onError]);

  const handleFallbackClick = async () => {
    if (!CLIENT_ID) {
      onError?.("Google sign-in is not configured (add VITE_GOOGLE_CLIENT_ID).");
      return;
    }
    setBusy(true);
    try {
      await loadGsi();
      window.google?.accounts?.id.prompt();
    } catch (e: unknown) {
      setBusy(false);
      onError?.(e instanceof Error ? e.message : "Could not start Google sign-in.");
    }
  };

  return (
    <div className="relative w-full overflow-hidden rounded-2xl">
      {/* Custom stylized Zentro button (visible to user) */}
      <button
        type="button"
        disabled={busy}
        onClick={handleFallbackClick}
        className={`grid h-14 w-full place-items-center gap-2.5 rounded-2xl border border-input bg-background text-sm font-medium text-ink transition-all hover:bg-mist/60 disabled:opacity-50 ${className}`}
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <span aria-hidden="true" className="inline-flex items-center gap-2.5">
            <GoogleG />
            <span>{label}</span>
          </span>
        )}
      </button>

      {/* Invisible Google official button overlay — ensures clicking opens the native popup dialog */}
      <div
        ref={overlayRef}
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center opacity-[0.0001] cursor-pointer overflow-hidden pointer-events-auto"
        style={{ transform: "scale(1.4)", transformOrigin: "center" }}
      />
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
