import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  Gift,
  Home,
  Map,
  Moon,
  ScanLine,
  Sun,
  Trophy,
  User,
  UtensilsCrossed,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useQuery } from "@tanstack/react-query";
import { notificationApi } from "@/lib/api";
import type { ReactNode } from "react";
import { ZentroLogo } from "@/components/brand/ZentroLogo";

type NavItem = { to: string; label: string; icon: typeof Home; center?: boolean };
const nav: NavItem[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/map", label: "Discover", icon: Map },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed },
  { to: "/cards", label: "Cards", icon: ScanLine, center: true },
  { to: "/rewards", label: "Rewards", icon: Gift },
  { to: "/leaderboard", label: "Ranks", icon: Trophy },
  { to: "/profile", label: "Profile", icon: User },
];

/** Dark, icon-only floating capsule nav, modeled on the current Instagram tab bar. */
function IgStyleNav({ path }: { path: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[460px]" aria-label="Primary">
      <div className="mx-3 mb-[max(10px,env(safe-area-inset-bottom))]">
        <div className="relative flex h-16 items-center justify-between rounded-[32px] bg-card px-2 shadow-elevated border border-border">
          {nav.map((item) => {
            const active = item.to === "/" ? path === item.to : path.startsWith(item.to);
            const Icon = item.icon;

            if (item.center) {
              return (
                <Link
                  key={item.to}
                  to={item.to as any}
                  aria-label={item.label}
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
                to={item.to as any}
                aria-label={item.label}
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
export function MobileShell({
  children,
  homeMode = false,
}: {
  children: ReactNode;
  homeMode?: boolean;
}) {
  const path = useRouterState({ select: (state) => state.location.pathname });

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
            <h1 className="zh-page-title">{title}</h1>
          ) : loading ? (
            <div className="zh-greeting-skeleton" />
          ) : (
            <div className="zh-greeting">
              <p>{getGreeting()},</p>
              <h1>
                {firstName || "Welcome"} <span aria-hidden>👋</span>
              </h1>
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
            to={"/notifications" as any}
            aria-label="Notifications"
            className="zh-circle-button zh-bell-button"
          >
            <Bell size={22} />
            {unreadCount > 0 && <span>{unreadCount > 9 ? "9+" : unreadCount}</span>}
          </Link>
          <Link to={"/profile" as any} aria-label="Profile" className="zh-avatar">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="Profile" />
            ) : (
              <span>{initial}</span>
            )}
          </Link>
        </div>
      </header>
    );
  }

  return (
    <header className="relative z-40 px-6 pb-2 pt-[max(28px,env(safe-area-inset-top))]">
      <div className="flex items-start justify-between gap-4">
        {/* Left: Logo + Greeting */}
        <div className="min-w-0 flex-1">
          <Link
            to="/"
            className="inline-flex items-center text-foreground"
            aria-label="Zentro home"
          >
            <ZentroLogo className="h-6 w-auto" title="" />
          </Link>
          {title ? (
            <h1 className="mt-3 text-[28px] font-semibold text-foreground">{title}</h1>
          ) : (
            <div className="mt-2">
              <p className="text-[15px] font-medium text-muted-foreground">{getGreeting()},</p>
              <h1 className="mt-0.5 text-[36px] font-extrabold leading-tight tracking-[-0.04em] text-foreground">
                {firstName || "Welcome"}{" "}
                <span className="relative inline-block" aria-hidden>
                  👋
                  <svg
                    className="absolute -top-3.5 left-0.5 h-4 w-4 opacity-75"
                    viewBox="0 0 24 24"
                  >
                    <line
                      x1="12"
                      y1="2"
                      x2="12"
                      y2="8"
                      stroke="#8D7CFF"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <line
                      x1="4"
                      y1="8"
                      x2="9"
                      y2="12"
                      stroke="#8D7CFF"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <line
                      x1="20"
                      y1="8"
                      x2="15"
                      y2="12"
                      stroke="#8D7CFF"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
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
            to={"/notifications" as any}
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
            to={"/profile" as any}
            className="grid h-12 w-12 place-items-center overflow-hidden rounded-full transition-transform active:scale-95"
            style={{
              boxShadow: "var(--shadow-card)",
              background: "linear-gradient(135deg, #E8E0FF, #D6CCFF)",
              padding: "2px",
            }}
          >
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt="Profile"
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center rounded-full bg-[#1B1B3A] text-[14px] font-bold text-white">
                {initial}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
