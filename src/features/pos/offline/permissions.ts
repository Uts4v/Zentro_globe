/**
 * What a cashier may still reach when the POS has no connection.
 *
 * Only two screens are built to work offline:
 *   /pos         — the menu snapshot and the cart live on this device, so an
 *                  order can still be taken, printed as a KOT and paid.
 *   /pos/orders  — lists the orders captured on this device and prints their
 *                  KOT and bill (neither exists on the server until sync).
 *
 * Everything else in the sidebar is a server round-trip — preparation, the
 * kitchen display, conflicts, accounts, cash movements, reports, schedule,
 * staff, settings — so with no connection it can only fail. Those entries are
 * disabled rather than left to time out on a tap.
 *
 * KOT printing, the offline bill and data sync are not screens: they are
 * actions reached from /pos/orders and from the sidebar footer, which is why
 * they keep working here.
 */

import {
  AlertTriangle,
  BarChart3,
  Calendar,
  Clock,
  CreditCard,
  HandCoins,
  LayoutDashboard,
  Settings,
  ShoppingCart,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Matched exactly. `/pos` is a prefix of every POS route, so treating it as a
 * prefix would allow `/pos/reports` and the rest.
 */
const OFFLINE_SAFE_EXACT = new Set(["/pos"]);

/** Matched exactly or as an ancestor, so nested order screens stay reachable. */
const OFFLINE_SAFE_PREFIXES = ["/pos/orders"];

/** True when `pathname` is one of the two screens that work with no server. */
export function isPosPathOfflineSafe(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (OFFLINE_SAFE_EXACT.has(path)) return true;
  return OFFLINE_SAFE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export type PosNavEntry = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Overridden with the live cart size on /pos. */
  badge?: number;
};

export type PosNavSection = {
  title: string;
  items: PosNavEntry[];
};

/**
 * The single source of truth for the POS sidebar.
 *
 * The desktop and mobile drawers used to repeat this list by hand, so a change
 * to one could silently miss the other; both render from here now.
 */
export const POS_NAV_SECTIONS: PosNavSection[] = [
  {
    title: "Operations",
    items: [
      { to: "/pos", label: "Order", icon: ShoppingCart },
      { to: "/pos/orders", label: "Orders", icon: Clock },
      { to: "/pos/preparation", label: "Preparation", icon: AlertTriangle },
      { to: "/pos/conflicts", label: "Conflicts", icon: AlertTriangle },
    ],
  },
  {
    title: "Money",
    items: [
      { to: "/pos/accounts", label: "Accounts", icon: CreditCard },
      { to: "/pos/cash-movements", label: "Cash In/Out", icon: HandCoins },
      { to: "/pos/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    title: "Team",
    items: [
      { to: "/pos/schedule", label: "Schedule", icon: Calendar },
      { to: "/pos/staff", label: "Staff", icon: Users },
    ],
  },
  {
    title: "Manage",
    items: [
      { to: "/merchant", label: "Dashboard", icon: LayoutDashboard },
      { to: "/pos/settings", label: "Settings", icon: Settings },
    ],
  },
];
