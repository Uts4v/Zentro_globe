// C:\Users\ACER\Desktop\NTE Loyalty\zentro-glow-loyalty\src\features\customer-management\pages\CustomerProfilePage.tsx
import { Link, useNavigate } from "@tanstack/react-router";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import {
  Settings,
  Bell,
  CreditCard,
  ChevronRight,
  LogOut,
  Loader2,
  ArrowLeftRight,
  Download,
} from "lucide-react";
import { customerApi, orderApi, type Order, type CustomerProfile } from "@/lib/api";
import { usePwa } from "@/features/pwa/PwaProvider";
import { useState, useEffect } from "react";

export function CustomerProfilePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      customerApi
        .profile()
        .then(setCustomerProfile)
        .catch(() => {}),
      orderApi
        .myOrders()
        .then(setOrders)
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth", search: {} as any });
  };

  const displayName = customerProfile?.full_name || user?.first_name || "Guest";
  const displayTier = customerProfile?.tier || "Bronze";
  const displayPoints = customerProfile?.loyalty_points ?? 0;
  const displayStreak = customerProfile?.streak_days ?? 0;
  const displayVisits = customerProfile?.total_orders ?? 0;

  return (
    <MobileShell>
      <TopBar />
      <section className="px-5">
        <div className="glass-strong flex items-center gap-4 rounded-3xl p-5">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl gradient-ember text-3xl text-white shadow-ember">
            ✨
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {displayTier} tier
            </p>
            <h1 className="font-display truncate text-3xl text-foreground">{displayName}</h1>
            <p className="text-xs text-muted-foreground">Zentro member</p>
          </div>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-3 gap-2 px-5">
        <Stat label="Points" value={displayPoints.toLocaleString()} />
        <Stat label="Streak" value={`${displayStreak}d`} />
        <Stat label="Visits" value={String(displayVisits)} />
      </section>

      <section className="mt-3 px-5">
        <div className="glass rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Your transfer code
            </p>
            <p className="mt-0.5 font-mono text-lg font-bold text-foreground tracking-[0.15em]">
              {user?.customer_profile?.transfer_code ?? customerProfile?.transfer_code ?? "—"}
            </p>
          </div>
          <Link
            to="/transfers"
            search={{ code: undefined }}
            className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-xs font-medium text-primary-foreground"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" /> Transfer points
          </Link>
        </div>
      </section>

      <section className="mt-6 px-5">
        <h2 className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Recent orders
        </h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : orders.length === 0 ? (
          <div className="glass-strong rounded-3xl p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No orders yet. Start by visiting a store!
            </p>
          </div>
        ) : (
          <div className="glass-strong divide-y divide-border rounded-3xl">
            {orders.slice(0, 5).map((o) => (
              <Link
                key={o.id}
                to="/orders/$id"
                params={{ id: String(o.id) }}
                className="flex items-center gap-3 p-4"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mist text-lg">
                  ☕
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">Order #{o.id}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {o.items?.length ?? o.order_items?.length ?? 0} items · {o.status}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display text-base text-foreground">
                    NPR {parseFloat(o.total_amount).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-ember">+{o.points_earned} pts</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 px-5">
        <div className="glass-strong divide-y divide-border rounded-3xl">
          <InstallAppRow />
          <Link to="/notifications" className="block">
            <Row icon={Bell} label="Notifications" />
          </Link>
          <Row icon={CreditCard} label="Payment methods" />
          <div className="flex items-center gap-3 p-4">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 text-sm text-foreground">Appearance</span>
            <ThemeToggle />
          </div>
          <button onClick={handleSignOut} className="flex w-full items-center gap-3 p-4 text-left">
            <LogOut className="h-4 w-4 text-destructive" />
            <span className="flex-1 text-sm text-destructive">Sign out</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </section>
    </MobileShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl p-3 text-center">
      <p className="font-display text-2xl text-foreground">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
    </div>
  );
}

function Row({ icon: Icon, label }: { icon: typeof Bell; label: string }) {
  return (
    <button className="flex w-full items-center gap-3 p-4 text-left">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 text-sm text-foreground">{label}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function InstallAppRow() {
  const { isInstallable, isInstalled, isStandalone, platform, promptInstall } = usePwa();
  const [showIosHint, setShowIosHint] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);

  if (installed || isInstalled || isStandalone || !isInstallable) return null;

  async function handleClick() {
    if (platform === "ios") {
      setShowIosHint((v) => !v);
      return;
    }
    setInstalling(true);
    try {
      if (await promptInstall()) setInstalled(true);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div>
      <button onClick={handleClick} disabled={installing} className="flex w-full items-center gap-3 p-4 text-left">
        <Download className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-sm text-foreground">
          {installing ? "Installing…" : "Download app"}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground rotate-90" />
      </button>
      {platform === "ios" && showIosHint && (
        <p className="px-4 pb-4 -mt-1 text-xs leading-relaxed text-muted-foreground">
          In Safari, tap the <span className="font-medium text-foreground">Share</span> icon, then{" "}
          <span className="font-medium text-foreground">Add to Home Screen</span>.
        </p>
      )}
    </div>
  );
}
