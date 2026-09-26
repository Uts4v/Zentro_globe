// src/features/inventory/pages/InventoryPage.tsx
import { useEffect, useState } from "react";
import {
  ArrowUpDown,
  ClipboardCheck,
  FileClock,
  LayoutDashboard,
  Package,
  PackagePlus,
  Truck,
  Trash2,
  Building2,
  History,
  Settings,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { OverviewTab } from "@/features/inventory/tabs/overview-tab";
import { ItemsTab } from "@/features/inventory/tabs/items-tab";
import { ReceivingTab } from "@/features/inventory/tabs/receiving-tab";
import { TransfersTab } from "@/features/inventory/tabs/transfers-tab";
import { StockCountsTab } from "@/features/inventory/tabs/stock-counts-tab";
import { WasteAdjustmentsTab } from "@/features/inventory/tabs/waste-adjustments-tab";
import { SuppliersTab } from "@/features/inventory/tabs/suppliers-tab";
import { MovementsTab } from "@/features/inventory/tabs/movements-tab";
import { SettingsTab } from "@/features/inventory/tabs/settings-tab";
import { ActionCard } from "@/features/inventory/components/bits";
import { inventoryApi, type InventoryRoot } from "@/lib/api";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "items", label: "Stock", icon: Package },
  { id: "counts", label: "Count Stock", icon: ClipboardCheck },
  { id: "actions", label: "Add / Move Stock", icon: PackagePlus },
  { id: "suppliers", label: "Suppliers", icon: Building2 },
  { id: "movements", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "receiving", label: "Add Delivery", icon: Truck },
  { id: "transfers", label: "Move Stock", icon: ArrowUpDown },
  { id: "waste", label: "Record Waste", icon: Trash2 },
  { id: "fix", label: "Fix Stock", icon: FileClock },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function InventoryPage() {
  const { merchantProfile } = useAuth();
  const [tab, setTab] = useState<TabId>("overview");
  const [capabilities, setCapabilities] = useState<InventoryRoot | null>(null);
  const sym = merchantProfile?.currency_symbol || "Rs";

  useEffect(() => {
    inventoryApi.root().then(setCapabilities).catch(() => void 0);
  }, []);

  const can = (permission: string) => capabilities?.permissions[permission] ?? true;
  const visibleTabs = TABS.filter((t) => {
    if (["receiving", "transfers", "waste"].includes(t.id)) return false;
    if (t.id === "suppliers") return can("inventory.manage_suppliers");
    if (t.id === "settings") return can("inventory.manage_settings");
    return true;
  });
  const hiddenActiveTab = TABS.find(
    (t) => t.id === tab && !visibleTabs.some((v) => v.id === t.id),
  );
  const renderedTabs = hiddenActiveTab ? [...visibleTabs, hiddenActiveTab] : visibleTabs;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Zentro Inventory
        </p>
        <h1 className="font-display mt-1 text-3xl text-foreground sm:text-4xl">Inventory</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          What do you need to do?
        </p>
      </div>

      {/* Tab bar */}
      <div
        className="flex flex-wrap gap-1.5 rounded-2xl border border-border bg-card p-1.5"
        role="tablist"
      >
        {renderedTabs.map((t) => {
          const Icon = t.icon;
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div>
        {tab === "overview" && <OverviewTab sym={sym} onNavigate={setTab} />}
        {tab === "items" && <ItemsTab sym={sym} />}
        {tab === "actions" && (
          <ActionCenter
            onNavigate={setTab}
            canReceive={can("inventory.receive")}
            canTransfer={can("inventory.transfer")}
            canWaste={can("inventory.record_waste")}
            canAdjust={can("inventory.adjust")}
          />
        )}
        {tab === "receiving" && <ReceivingTab sym={sym} />}
        {tab === "transfers" && <TransfersTab />}
        {tab === "counts" && <StockCountsTab />}
        {tab === "waste" && <WasteAdjustmentsTab sym={sym} />}
        {tab === "fix" && <WasteAdjustmentsTab sym={sym} initialMode="adjustment" />}
        {tab === "suppliers" && <SuppliersTab sym={sym} />}
        {tab === "movements" && <MovementsTab />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}

function ActionCenter({
  onNavigate,
  canReceive,
  canTransfer,
  canWaste,
  canAdjust,
}: {
  onNavigate: (tab: TabId) => void;
  canReceive: boolean;
  canTransfer: boolean;
  canWaste: boolean;
  canAdjust: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl text-foreground">Add / Move Stock</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose what happened in the restaurant.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {canReceive && <ActionCard icon={Truck} title="Add Delivery" description="New stock arrived." onClick={() => onNavigate("receiving")} />}
        {canTransfer && <ActionCard icon={ArrowUpDown} title="Move Stock" description="Move items to another area." onClick={() => onNavigate("transfers")} />}
        {canWaste && <ActionCard icon={Trash2} title="Record Waste" description="Something was spoiled, broken, or thrown away." onClick={() => onNavigate("waste")} />}
        {canAdjust && <ActionCard icon={FileClock} title="Fix Stock" description="Correct a stock number." onClick={() => onNavigate("fix")} />}
      </div>
    </div>
  );
}
