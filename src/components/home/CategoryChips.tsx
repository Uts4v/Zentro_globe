// src/components/home/CategoryChips.tsx
// Horizontal scrollable category chips with merchant accent color
interface CategoryChipsProps {
  categories: string[];
  active: string;
  onSelect: (cat: string) => void;
  merchantColor?: string;
}

export function CategoryChips({ categories, active, onSelect, merchantColor }: CategoryChipsProps) {
  if (categories.length <= 1) return null;

  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pb-1">
      {categories.map((c) => {
        const isActive = c === active;
        return (
          <button
            key={c}
            onClick={() => onSelect(c)}
            className="shrink-0 rounded-full px-4 py-2 text-xs font-medium transition-all duration-200"
            style={
              isActive
                ? {
                    background: "var(--foreground)",
                    color: "var(--background)",
                    boxShadow: "0 4px 14px rgba(26,26,26,0.2)",
                  }
                : {
                    background: "var(--mist)",
                    color: "var(--foreground)",
                  }
            }
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
