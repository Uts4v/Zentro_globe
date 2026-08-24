import { Link, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ZentroLogo } from "@/components/brand/ZentroLogo";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

interface MerchantNavProps {
  navItems: NavItem[];
  onSignOut: () => void;
  onLinkClick?: () => void;
}

export function MerchantNav({ navItems, onSignOut, onLinkClick }: MerchantNavProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex h-full flex-col gap-1 p-4">
      {/* Logo */}
      <Link
        to="/"
        className="mb-4 flex items-center px-2 py-1 text-foreground"
        onClick={onLinkClick}
        aria-label="Zentro home"
      >
        <ZentroLogo className="h-7 w-auto" title="" />
      </Link>

      {/* Nav links */}
      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive =
            to === "/merchant/"
              ? pathname === "/merchant" || pathname === "/merchant/"
              : pathname.startsWith(to);

          return (
            <Link
              key={to}
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
          );
        })}
      </nav>

      {/* Theme toggle */}
      <div className="px-2 py-2">
        <ThemeToggle />
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
