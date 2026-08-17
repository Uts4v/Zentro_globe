// src/features/loyalty-engine/pages/MerchantCustomersPage.tsx
import { useEffect, useMemo, useState } from "react";
import { Users, Phone, Mail, Star, Search, Loader2 } from "lucide-react";
import {
  merchantCustomersApi,
  type MerchantCustomer,
} from "@/lib/api";

const TIER_STYLES: Record<string, string> = {
  bronze: "bg-orange-100 text-orange-700",
  silver: "bg-gray-100 text-gray-700",
  gold: "bg-yellow-100 text-yellow-700",
  platinum: "bg-purple-100 text-purple-700",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function MerchantCustomersPage() {
  const [customers, setCustomers] = useState<MerchantCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    merchantCustomersApi
      .list()
      .then(setCustomers)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.customer_name.toLowerCase().includes(q) ||
        (c.customer_phone || "").toLowerCase().includes(q) ||
        (c.customer_email || "").toLowerCase().includes(q) ||
        (c.membership_number || "").toLowerCase().includes(q)
    );
  }, [customers, query]);

  const totals = useMemo(() => {
    const active = customers.filter((c) => c.status === "active").length;
    const points = customers.reduce((sum, c) => sum + (c.points_balance || 0), 0);
    return { total: customers.length, active, points };
  }, [customers]);

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-ember" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Customers</h1>
            <p className="text-xs text-muted-foreground">
              Everyone linked to your business
            </p>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Total Customers
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">{totals.total}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Active Members
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">{totals.active}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Points Issued
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {totals.points.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, phone, email, or membership number..."
          className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-4 text-sm focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
        />
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {query ? "No customers match your search." : "No customers yet."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="hidden grid-cols-12 gap-2 border-b border-border bg-muted/40 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground md:grid">
            <span className="col-span-4">Customer</span>
            <span className="col-span-3">Membership</span>
            <span className="col-span-2">Points</span>
            <span className="col-span-2">Joined</span>
            <span className="col-span-1">Status</span>
          </div>
          <ul className="divide-y divide-border">
            {filtered.map((c) => (
              <li
                key={c.membership_id}
                className="grid grid-cols-1 gap-2 px-5 py-4 md:grid-cols-12 md:items-center md:gap-2"
              >
                <div className="col-span-4">
                  <div className="flex items-center gap-2">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink/10 text-xs font-bold text-ink">
                      {(c.customer_name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {c.customer_name}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {c.customer_phone ? (
                          <span className="flex items-center gap-0.5">
                            <Phone className="h-3 w-3" /> {c.customer_phone}
                          </span>
                        ) : null}
                        {c.customer_email ? (
                          <span className="flex items-center gap-0.5 truncate">
                            <Mail className="h-3 w-3" /> {c.customer_email}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-span-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-ink/10 px-2 py-0.5 font-mono text-[11px] font-bold text-ink">
                      {c.membership_number || "—"}
                    </span>
                    {c.tier && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${
                          TIER_STYLES[c.tier] || "bg-mist text-muted-foreground"
                        }`}
                      >
                        {c.tier}
                      </span>
                    )}
                  </div>
                </div>
                <div className="col-span-2">
                  <span className="flex items-center gap-1 text-sm font-bold text-foreground">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {c.points_balance.toLocaleString()}
                  </span>
                </div>
                <div className="col-span-2 text-xs text-muted-foreground">
                  {formatDate(c.joined_at)}
                </div>
                <div className="col-span-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${
                      c.status === "active"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-mist text-muted-foreground"
                    }`}
                  >
                    {c.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
