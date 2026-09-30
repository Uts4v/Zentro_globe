// src/features/inventory/components/ItemPicker.tsx
// Searchable stock item picker. Searches on the server (paginated), so it
// stays fast with thousands of items. Keyboard: ↑/↓ to move, Enter to pick.
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { inventoryApi, type InventoryItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatQty, inputCls, useDebounced } from "@/features/inventory/components/bits";
import { copy } from "@/features/inventory/copy";

export function ItemPicker({
  id,
  value,
  onChange,
  locationId,
  placeholder = copy.stock.searchPlaceholder,
  autoFocus,
}: {
  id?: string;
  value: InventoryItem | null;
  onChange: (item: InventoryItem | null) => void;
  /** Show how much is at this place next to each result. */
  locationId?: number | null;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const q = useDebounced(text, 250);

  const results = useQuery({
    queryKey: ["inventory", "picker", q, locationId ?? null],
    queryFn: () => inventoryApi.items({ q: q || undefined, page_size: 15, location: undefined }),
    enabled: open,
    staleTime: 15_000,
  });
  const items = results.data?.results ?? [];

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(item: InventoryItem) {
    onChange(item);
    setText("");
    setOpen(false);
  }

  function stockAt(item: InventoryItem) {
    if (locationId) {
      const here = item.locations.find((l) => l.location === locationId);
      return `${formatQty(here?.on_hand ?? 0)} ${item.base_unit_code}`;
    }
    return `${formatQty(item.total_stock)} ${item.base_unit_code}`;
  }

  if (value) {
    return (
      <div className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{value.name}</p>
          <p className="text-xs text-muted-foreground">
            {stockAt(value)} {locationId ? "" : `· ${value.location_name || "—"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`${copy.common.close} ${value.name}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        className={cn(inputCls, "pl-9")}
        placeholder={placeholder}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && items[active]) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
        >
          {results.isLoading && (
            <li className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {copy.common.loading}
            </li>
          )}
          {!results.isLoading && items.length === 0 && (
            <li className="px-3 py-3 text-sm text-muted-foreground">{copy.stock.noResults}</li>
          )}
          {items.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm",
                i === active ? "bg-muted" : "",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">{item.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {item.location_name || item.category_name}
                  {item.sku ? ` · ${item.sku}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                {stockAt(item)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LocationSelect({
  id,
  value,
  onChange,
  locations,
  placeholder = copy.itemForm.choose,
  allowEmpty = false,
  emptyLabel,
}: {
  id?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  locations: { id: number; name: string }[];
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  return (
    <select
      id={id}
      className={inputCls}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="" disabled={!allowEmpty}>
        {allowEmpty ? (emptyLabel ?? placeholder) : placeholder}
      </option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
