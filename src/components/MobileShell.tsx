import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  Gift,
  Home,
  Map,
  Moon,
  Sun,
  Trophy,
  User,
  UtensilsCrossed,
  WalletCards,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useQuery } from "@tanstack/react-query";
import { notificationApi } from "@/lib/api";
import { useState, type ReactNode } from "react";
import { ZentroLogo } from "@/components/brand/ZentroLogo";

type NavItem = {
  to: "/" | "/map" | "/menu" | "/cards" | "/rewards" | "/leaderboard" | "/profile";
  label: string;
  icon: typeof Home;
  center?: boolean;
  /** Other paths that belong to this tab (e.g. Offers lives under Discover). */
  also?: (path: string) => boolean;
};
const isMyOffers = (path: string) => path.startsWith("/offers/mine");
const nav: NavItem[] = [
  { to: "/", label: "Home", icon: Home },
  {
    to: "/map",
    label: "Discover",
    icon: Map,
    also: (path) => path.startsWith("/offers") && !isMyOffers(path),
  },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed },
  // Saved membership cards and saved offers are both "Wallet".
  { to: "/cards", label: "Wallet", icon: WalletCards, center: true, also: isMyOffers },
  { to: "/rewards", label: "Rewards", icon: Gift },
  { to: "/leaderboard", label: "Ranks", icon: Trophy },
  { to: "/profile", label: "Profile", icon: User },
];

function isActive(item: NavItem, path: string) {
  if (item.to === "/") return path === "/";
  return path.startsWith(item.to) || Boolean(item.also?.(path));
}

/** Dark, icon-only floating capsule nav, modeled on the current Instagram tab bar. */
function IgStyleNav({ path }: { path: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[460px]" aria-label="Primary">
      <div className="mx-3 mb-[max(10px,env(safe-area-inset-bottom))]">
        <div className="relative flex h-16 items-center justify-between rounded-[32px] bg-card px-2 shadow-elevated border border-border">
          {nav.map((item) => {
            const active = isActive(item, path);
            const Icon = item.icon;

            if (item.center) {
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  className="relative -mt-6 flex flex-col items-center"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black text-white shadow-[0_10px_25px_rgba(0,0,0,0.3)] transition-transform active:scale-90">
                    <Icon size={24} strokeWidth={2.2} />
                  </span>
                  <span className="mt-0.5 text-[9px] font-bold text-foreground">{item.label}</span>
                </Link>
              );
            }

            return (
              <Link
                key={item.to}
                to={item.to}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className="relative flex flex-1 flex-col items-center justify-center py-1"
              >
                <Icon
                  size={20}
                  strokeWidth={active ? 2.2 : 1.6}
                  className={active ? "text-foreground" : "text-muted-foreground"}
                />
                <span
                  className={`mt-0.5 text-[9px] font-bold transition-colors ${
                    active ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {item.label}
                </span>
                {active && <span className="mt-0.5 h-1 w-1 rounded-full bg-foreground" />}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
/** Desktop (lg+) navigation for pages that opt into the wide layout. */
function DesktopSidebar({ path }: { path: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-card/60 px-4 py-6 lg:flex">
      <Link to="/" aria-label="Zentro home" className="mb-8 inline-flex px-3 text-foreground">
        <ZentroLogo className="h-7 w-auto" title="" />
      </Link>
      <nav aria-label="Primary" className="flex flex-col gap-1">
        {nav.map((item) => {
          const active = isActive(item, path);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-200 ${
                active
                  ? "bg-primary/10 font-bold text-primary dark:bg-primary/15"
                  : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function MobileShell({
  children,
  homeMode = false,
  wide = false,
}: {
  children: ReactNode;
  homeMode?: boolean;
  /**
   * Responsive layout: phone column below md, roomier on tablets, and a
   * sidebar with a full-width content area on desktop (no bottom nav there).
   */
  wide?: boolean;
}) {
  const path = useRouterState({ select: (state) => state.location.pathname });

  if (wide) {
    return (
      <div className="zentro-wide min-h-dvh overflow-x-hidden bg-background">
        <DesktopSidebar path={path} />
        <div className="relative mx-auto flex min-h-dvh max-w-[460px] flex-col pb-28 md:max-w-3xl lg:ml-60 lg:max-w-none lg:pb-16">
          <div className="mx-auto flex w-full flex-1 flex-col lg:max-w-[1240px] lg:px-4">
            {children}
          </div>
        </div>
        <div className="lg:hidden">
          <IgStyleNav path={path} />
        </div>
      </div>
    );
  }

  if (homeMode) {
    return (
      <div className="zh-shell">
        {children}
        <IgStyleNav path={path} />
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-dvh max-w-[460px] flex-col overflow-x-hidden bg-background pb-28">
      <div className="relative z-10 flex min-h-dvh flex-col">{children}</div>
      <IgStyleNav path={path} />
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getInitial(name: string | null | undefined): string {
  if (!name) return "Z";
  return name.trim().charAt(0).toUpperCase();
}

export function TopBar({
  title,
  right,
  homeMode = false,
}: {
  title?: string;
  right?: ReactNode;
  homeMode?: boolean;
}) {
  const { user, loading } = useAuth();
  const { data } = useQuery({
    queryKey: ["notifications", "unreadCount"],
    queryFn: () => notificationApi.unreadCount(),
    enabled: Boolean(user),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const unreadCount = data?.unread_count ?? 0;
  const firstName = user?.first_name ?? null;
  const initial = getInitial(firstName);
  const { resolved, setTheme, theme } = useTheme();

  function cycleTheme() {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  }

  if (homeMode) {
    return (
      <header className="zh-header">
        <div className="zh-header-copy">
          <Link
            to="/"
            className="zh-brand inline-flex items-center text-foreground"
            aria-label="Zentro home"
          >
            <ZentroLogo className="h-7 w-auto" title="" />
          </Link>
          {title ? (
            <p className="zh-page-title">{title}</p>
          ) : loading ? (
            <div className="zh-greeting-skeleton" />
          ) : (
            <div className="zh-greeting">
              <p>{getGreeting()},</p>
              <p>{firstName || "Welcome"}</p>
            </div>
          )}
        </div>

        <div className="zh-header-actions">
          {right}
          <button
            type="button"
            onClick={cycleTheme}
            aria-label="Change appearance"
            className="zh-circle-button"
          >
            {resolved === "dark" ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <Link
            to="/notifications"
            aria-label="Notifications"
            className="zh-circle-button zh-bell-button"
          >
            <Bell size={22} />
            {unreadCount > 0 && <span>{unreadCount > 9 ? "9+" : unreadCount}</span>}
          </Link>
          <Link to="/profile" aria-label="Profile" className="zh-avatar">
            <AvatarImage src={user?.avatar_url} initial={initial} />
          </Link>
        </div>
      </header>
    );
  }

  return (
    <header className="relative z-40 px-6 pb-1 pt-[max(20px,env(safe-area-inset-top))]">
      <div className="flex items-start justify-between gap-4">
        {/* Left: Logo + Greeting */}
        <div className="min-w-0 flex-1">
          <Link
            to="/"
            className="zentro-topbar-logo inline-flex items-center text-foreground"
            aria-label="Zentro home"
          >
            <ZentroLogo className="h-6 w-auto" title="" />
          </Link>
          {title ? (
            <h1 className="mt-2 text-[24px] font-semibold text-foreground">{title}</h1>
          ) : (
            <div className="mt-1">
              <p className="text-[13px] font-medium text-muted-foreground">{getGreeting()},</p>
              <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-foreground">
                {firstName || "Welcome"}
              </h1>
            </div>
          )}
        </div>
        {/* Right: Action buttons */}
        <div className="flex shrink-0 items-center gap-2.5 pt-1">
          {right}
          <button
            type="button"
            onClick={cycleTheme}
            className="grid h-11 w-11 place-items-center rounded-full bg-card text-foreground transition-transform active:scale-95"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            {resolved === "dark" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <Link
            to="/notifications"
            className="relative grid h-12 w-12 place-items-center rounded-full bg-card transition-transform active:scale-95"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <Bell size={20} className="text-foreground" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Link>
          <Link
            to="/profile"
            className="grid h-12 w-12 place-items-center overflow-hidden rounded-full transition-transform active:scale-95"
            style={{
              boxShadow: "var(--shadow-card)",
              background: "linear-gradient(135deg, #E8E0FF, #D6CCFF)",
              padding: "2px",
            }}
          >
            <AvatarImage
              src={user?.avatar_url}
              initial={initial}
              className="h-full w-full rounded-full object-cover"
              fallbackClassName="flex h-full w-full items-center justify-center rounded-full bg-[#1B1B3A] text-[14px] font-bold text-white"
            />
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Profile photo that falls back to the initial if it is missing or fails to load. */
function AvatarImage({
  src,
  initial,
  className,
  fallbackClassName,
}: {
  src?: string | null;
  initial: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <span className={fallbackClassName} aria-hidden="true">
        {initial}
      </span>
    );
  }
  return <img src={src} alt="" className={className} onError={() => setFailedSrc(src)} />;
}
