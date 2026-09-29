import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import type { MenuCategory, MenuItem } from "@/lib/api";

export interface TargetRef {
  menu_item?: number;
  category?: number;
  option?: number;
  label: string;
}

export function targetKey(t: TargetRef): string {
  if (t.category) return `c${t.category}`;
  if (t.option) return `o${t.option}`;
  return `i${t.menu_item}`;
}

/**
 * Choose categories, products or specific variants from the merchant's own menu.
 * Only this merchant's menu is ever listed (the server re-checks ownership).
 */
export function TargetPicker({
  items,
  categories,
  value,
  onChange,
  allowVariants = true,
}: {
  items: MenuItem[];
  categories: MenuCategory[];
  value: TargetRef[];
  onChange: (next: TargetRef[]) => void;
  allowVariants?: boolean;
}) {
  const [search, setSearch] = useState("");
  const selected = useMemo(() => new Set(value.map(targetKey)), [value]);

  function toggle(t: TargetRef) {
    const key = targetKey(t);
    onChange(selected.has(key) ? value.filter((v) => targetKey(v) !== key) : [...value, t]);
  }

  const term = search.trim().toLowerCase();
  const visibleItems = items.filter(
    (i) => i.status !== "archived" && (!term || i.name.toLowerCase().includes(term)),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => {
          const t = { category: Number(c.id), label: c.name };
          const on = selected.has(targetKey(t));
          return (
            <button
              type="button"
              key={c.id}
              onClick={() => toggle(t)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-ink text-primary-foreground" : "bg-mist text-foreground"}`}
            >
              {on && <Check className="mr-1 inline h-3 w-3" />}
              {c.emoji} {c.name} <span className="opacity-60">(whole category)</span>
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products"
          aria-label="Search products"
          className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
        />
      </label>
      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {visibleItems.map((item) => {
          const itemTarget = { menu_item: Number(item.id), label: item.name };
          const variantGroups = (item.groups ?? []).filter((g) => g.kind === "variant");
          return (
            <div key={item.id} className="rounded-xl border border-border">
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(targetKey(itemTarget))}
                  onChange={() => toggle(itemTarget)}
                />
                <span className="flex-1 text-foreground">{item.name}</span>
                <span className="text-xs text-muted-foreground">{item.price}</span>
              </label>
              {allowVariants &&
                variantGroups.map((g) =>
                  g.options.map((o) => {
                    const t = { option: Number(o.id), label: `${item.name} (${o.name})` };
                    return (
                      <label
                        key={o.id}
                        className="flex cursor-pointer items-center gap-2.5 py-1.5 pl-9 pr-3 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(targetKey(t))}
                          onChange={() => toggle(t)}
                        />
                        <span className="flex-1 text-muted-foreground">
                          {g.name}: {o.name} only
                        </span>
                      </label>
                    );
                  }),
                )}
            </div>
          );
        })}
        {visibleItems.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">No products found.</p>
        )}
      </div>
      {value.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Selected: <span className="text-foreground">{value.map((v) => v.label).join(", ")}</span>
        </p>
      )}
    </div>
  );
}
