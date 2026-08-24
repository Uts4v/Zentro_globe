// src/routes/__root.tsx
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useNavigate,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { MerchantThemeProvider } from "@/lib/merchant-theme";
import { PwaProvider } from "@/features/pwa/PwaProvider";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ZentroSplashScreen } from "@/components/brand/ZentroSplashScreen";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { getWsToken } from "@/lib/ws";
import { registerPushSubscription } from "@/lib/push";

// Routes that never require auth
const PUBLIC_ROUTES = ["/auth", "/auth/merchant", "/auth/forgot-password", "/auth/reset-password"];

// ── Auth gate ─────────────────────────────────────────────────────────────────
// Renders children immediately; redirects to /auth once auth finishes loading
// and no user is found. This avoids blocking FCP with a spinner.
function AuthGate() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isPublic = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));
  const isMerchant = pathname.startsWith("/merchant");

  useEffect(() => {
    if (loading) return;
    if (user) return;
    if (isPublic) return;

    if (isMerchant) {
      navigate({
        to: "/auth/merchant" as any,
        search: { redirect: pathname } as any,
        replace: true,
      });
    } else {
      navigate({
        to: "/auth" as any,
        search: { redirect: pathname } as any,
        replace: true,
      });
    }
  }, [user, loading, isPublic, pathname]);

  return <Outlet />;
}

// ── Not found ─────────────────────────────────────────────────────────────────
function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="glass max-w-md rounded-3xl p-10 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">404</p>
        <h1 className="font-display mt-3 text-5xl text-ink">Lost in the steam</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This page wandered off. Let's head back to the counter.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-ink px-6 text-sm font-medium text-primary-foreground"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}

// ── Error boundary ────────────────────────────────────────────────────────────
function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="glass max-w-md rounded-3xl p-10 text-center">
        <h1 className="font-display text-3xl text-ink">Something spilled</h1>
        <p className="mt-2 text-sm text-muted-foreground">Give it another try.</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-ink px-6 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

// ── Route definition ──────────────────────────────────────────────────────────
type RouterContext = {
  queryClient: QueryClient;
  auth?: ReturnType<typeof useAuth>;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Zentro — Order & Loyalty" },
      {
        name: "description",
        content: "Premium coffee ordering with a loyalty card that feels like a keepsake.",
      },
      { property: "og:title", content: "Zentro — Order & Loyalty" },
      {
        property: "og:description",
        content: "Order, earn, redeem. A modern loyalty experience for your favorite cafés.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "theme-color", content: "#FA6A4A" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "preload",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&family=Instrument+Serif:ital@0;1&display=swap",
        as: "style",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&family=Instrument+Serif:ital@0;1&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/pwa-192x192.svg" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// ── Inner root — injects auth into router context ─────────────────────────────
function InnerRoot() {
  const auth = useAuth();
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useMemo(() => {
    router.options.context = { ...router.options.context, auth };
  }, [auth, router]);

  return <Outlet />;
}

// ── WebSocket notification toasts ─────────────────────────────────────────────
function GlobalNotificationToasts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;

    // Defer WebSocket connection until after page load to avoid blocking initial render
    const connectWebSocket = async (): Promise<WebSocket | undefined> => {
      let token: string;
      try {
        token = await getWsToken();
      } catch {
        // Not authenticated or backend unreachable — retry on next mount.
        return undefined;
      }
      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const apiHost =
        (import.meta.env.VITE_DJANGO_API_BASE_URL as string | undefined)
          ?.replace(/^https?:\/\//, "")
          ?.replace(/\/api\/?$/, "") || window.location.host;
      const wsUrl = `${wsProto}//${apiHost}/ws/notifications/?token=${token}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("Notification WebSocket connected");
      };

      ws.onmessage = (event) => {
        try {
          const notif = JSON.parse(event.data);
          toast.success(notif.title, {
            description: notif.message,
            duration: 6000,
          });
          queryClient.invalidateQueries({ queryKey: ["notifications", "list"] });
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        console.warn("Notification WebSocket error — will retry on next mount");
      };

      ws.onclose = () => {
        console.log("Notification WebSocket closed");
      };

      return ws;
    };

    let ws: WebSocket | undefined;
    let cancelled = false;

    const start = async () => {
      const socket = await connectWebSocket();
      if (cancelled) {
        socket?.close();
        return;
      }
      ws = socket;
    };

    if (document.readyState === "complete") {
      void start();
    } else {
      const onLoad = () => {
        void start();
      };
      window.addEventListener("load", onLoad, { once: true });
      return () => {
        cancelled = true;
        window.removeEventListener("load", onLoad);
        ws?.close();
      };
    }

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [user, queryClient]);

  // Subscribe installed-PWA users to Web Push (OS-level notifications).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (!cancelled) void registerPushSubscription(user.id);
    }, 3000); // give the SW a moment to activate
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [user]);

  return null;
}

// ── Root component ────────────────────────────────────────────────────────────
function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MerchantThemeProvider>
          <PwaProvider>
            <AuthProvider>
              <GlobalNotificationToasts />
              <InnerRoot />
              <Toaster position="top-center" richColors expand visibleToasts={4} />
            </AuthProvider>
          </PwaProvider>
        </MerchantThemeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────
function RootShell({ children }: { children: ReactNode }) {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("zentro-theme");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {showSplash && (
          <ZentroSplashScreen onFinish={() => setShowSplash(false)} autoUnmount={false} />
        )}
        {children}
        <Scripts />
      </body>
    </html>
  );
}
