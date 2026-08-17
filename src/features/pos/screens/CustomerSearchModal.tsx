import { useState, useEffect, useRef } from "react";
import { posSearchCustomers, posCreateCustomer, PosCustomer } from "../api";
import { Search, User, Star, X, Loader2, UserPlus, Check } from "lucide-react";
import { useDebouncedValue } from "@/lib/use-debounce";

interface CustomerSearchModalProps {
  onSelect: (customer: PosCustomer) => void;
  onClose: () => void;
}

const TIER_COLORS: Record<string, string> = {
  bronze: "bg-orange-100 text-orange-700",
  silver: "bg-gray-100 text-gray-700",
  gold: "bg-yellow-100 text-yellow-700",
  platinum: "bg-purple-100 text-purple-700",
};

export default function CustomerSearchModal({
  onSelect,
  onClose,
}: CustomerSearchModalProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 350);
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (showNewForm) {
      newNameRef.current?.focus();
    }
  }, [showNewForm]);

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

  function handleAddNew() {
    const name = newName.trim();
    const phone = newPhone.trim();
    if (!name) return;
    setCreating(true);
    setCreateError("");
    posCreateCustomer({ full_name: name, phone })
      .then((customer) => {
        onSelect(customer);
      })
      .catch((err) => {
        setCreateError(
          (err as { data?: { error?: string } })?.data?.error ||
            "Could not add customer"
        );
        setCreating(false);
      });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-3xl bg-card shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold text-foreground">Select Customer</h2>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-mist"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search input */}
        <div className="px-5 py-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowNewForm(false);
              }}
              placeholder="Search by name, phone, or customer ID..."
              className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-10 text-sm focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto px-5 pb-4">
          {query.length < 2 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search
            </p>
          ) : results.length === 0 && !loading ? (
            <div className="py-4 text-center">
              <p className="text-sm text-muted-foreground">
                No customers found
              </p>
              <button
                onClick={() => {
                  setShowNewForm(true);
                  setNewName(query);
                }}
                className="mx-auto mt-3 flex items-center gap-1.5 rounded-xl bg-ember-soft px-4 py-2 text-sm font-semibold text-ember transition-colors hover:bg-ember hover:text-white"
              >
                <UserPlus className="h-4 w-4" />
                Add "{query}" as a new customer
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((customer) => (
                <button
                  key={customer.id}
                  onClick={() => onSelect(customer)}
                  className="group flex w-full items-center gap-3 rounded-2xl border border-border bg-background p-3 text-left transition-all hover:border-ember/40 hover:bg-ember-soft/20"
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink/10">
                    <User className="h-5 w-5 text-ink" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {customer.full_name || customer.email}
                      </p>
                      {customer.tier && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold capitalize ${TIER_COLORS[customer.tier] || "bg-mist text-muted-foreground"}`}
                        >
                          {customer.tier}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {customer.phone || customer.email || "No contact"}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="flex items-center gap-1 text-[11px] text-amber-600">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        {customer.loyalty_points} pts
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {customer.total_orders}{" "}
                        {customer.total_orders === 1
                          ? "previous order"
                          : "previous orders"}
                      </span>
                      {customer.membership_number && (
                        <span className="rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-ink">
                          {customer.membership_number}
                        </span>
                      )}
                    </div>
                  </div>
                  <Check className="h-4 w-4 shrink-0 text-ember opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Add new customer form / action */}
        <div className="border-t border-border px-5 py-3">
          {showNewForm ? (
            <div className="space-y-2">
              <input
                ref={newNameRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
              />
              <input
                type="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="Phone (e.g. 98XXXXXXXX)"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
              />
              <button
                onClick={handleAddNew}
                disabled={creating || !newName.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-ember py-3 text-sm font-bold text-white transition-colors hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                ) : (
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                )}
                {creating
                  ? "Adding..."
                  : `Link ${newName.trim() || "Walk-in Customer"}`}
              </button>
              {createError && (
                <p className="text-xs font-medium text-red-500">{createError}</p>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowNewForm(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-ember/50 hover:bg-ember-soft/30 hover:text-ember"
            >
              <UserPlus className="h-4 w-4" />
              Add New Customer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
