import { useState, useEffect, useRef } from "react";
import { posSearchCustomers, PosCustomer } from "../api";
import { Search, User, Star, X, Loader2 } from "lucide-react";
import { useDebouncedValue } from "@/lib/use-debounce";

interface CustomerSearchModalProps {
  onSelect: (customer: PosCustomer) => void;
  onClose: () => void;
}

export default function CustomerSearchModal({ onSelect, onClose }: CustomerSearchModalProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 350);
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    posSearchCustomers(debouncedQuery, controller.signal)
      .then((data) => {
        if (active) setResults(data);
      })
      .catch((err) => {
        if (active && (err as Error).name !== "AbortError") setResults([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [debouncedQuery]);

  const TIER_COLORS: Record<string, string> = {
    bronze: "bg-orange-100 text-orange-700",
    silver: "bg-gray-100 text-gray-700",
    gold: "bg-yellow-100 text-yellow-700",
    platinum: "bg-purple-100 text-purple-700",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold text-foreground">Link Customer</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search input */}
        <div className="px-5 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email, phone, transfer code, or membership #..."
              className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-4 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto px-5 pb-5">
          {query.length < 2 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search
            </p>
          ) : results.length === 0 && !loading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No customers found
            </p>
          ) : (
            <div className="space-y-2">
              {results.map((customer) => (
                <button
                  key={customer.id}
                  onClick={() => onSelect(customer)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-background p-3 text-left transition-colors hover:border-ink/30 hover:bg-muted/50"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-ink/10">
                    <User className="h-5 w-5 text-ink" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">
                        {customer.full_name || customer.email}
                      </p>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${TIER_COLORS[customer.tier] || ""}`}>
                        {customer.tier}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {customer.email} &middot; {customer.phone || "No phone"}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-[10px] text-amber-600">
                        <Star className="h-3 w-3" />
                        {customer.loyalty_points} pts
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {customer.total_orders} orders
                      </span>
                      {customer.membership_number && (
                        <span className="rounded bg-ink/10 px-1 py-0.5 text-[10px] font-mono font-bold text-ink">
                          {customer.membership_number}
                        </span>
                      )}
                      {!customer.membership_number && (
                        <span className="text-[10px] text-muted-foreground">
                          Code: {customer.transfer_code}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Walk-in option */}
        <div className="border-t border-border px-5 py-3">
          <button
            onClick={() => onSelect({ id: 0, full_name: "Walk-in Customer", email: "", phone: "", transfer_code: "", membership_number: "", loyalty_points: 0, tier: "bronze", total_orders: 0 })}
            className="w-full rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:bg-muted"
          >
            Continue as Walk-in Customer
          </button>
        </div>
      </div>
    </div>
  );
}
