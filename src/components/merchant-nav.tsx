import { Link, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ZentroLogo } from "@/components/brand/ZentroLogo";
import type { LucideIcon } from "lucide-react";
import type React from "react";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  section?: string;
  disabled?: boolean;
  badge?: string;
}

interface MerchantNavProps {
  navItems: NavItem[];
  onSignOut: () => void;
  onLinkClick?: () => void;
  bell?: React.ReactNode;
}

export function MerchantNav({ navItems, onSignOut, onLinkClick, bell }: MerchantNavProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  let lastSection = "";

  return (
    <div className="flex h-full flex-col gap-1 p-4">
      {/* Logo */}
      <div className="mb-4 flex items-center justify-between px-2 py-1">
        <Link
          to="/"
          className="flex items-center text-foreground"
          onClick={onLinkClick}
          aria-label="Zentro home"
        >
          <ZentroLogo className="h-7 w-auto" title="" />
        </Link>
        {bell && <div className="flex items-center">{bell}</div>}
      </div>

      {/* Nav links */}
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-1">
        {navItems.map(({ to, label, icon: Icon, section, disabled, badge }) => {
          const isActive =
            to === "/merchant/"
              ? pathname === "/merchant" || pathname === "/merchant/"
              : pathname.startsWith(to);

          const showSection = section && section !== lastSection;
          if (section) lastSection = section;

          return (
            <div key={to}>
              {showSection && (
                <p className="mt-3 mb-1 px-3 text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60 font-medium">
                  {section}
                </p>
              )}
              {disabled ? (
                <button
                  type="button"
                  aria-disabled="true"
                  title={`${label} — ${badge ?? "Coming soon"}`}
                  className="flex w-full cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground/50"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{label}</span>
                  {badge && (
                    <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                      {badge}
                    </span>
                  )}
                </button>
              ) : (
                <Link
                  to={to as any}
                  onClick={onLinkClick}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              )}
            </div>
          );
        })}
      </nav>

      {/* Theme toggle */}
      <div className="px-2 py-2">
        <ThemeToggle compact />
      </div>

      {/* Sign out */}
      <button
        onClick={onSignOut}
        className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <LogOut className="h-4 w-4 shrink-0" />
        Sign out
      </button>
    </div>
  );
}
