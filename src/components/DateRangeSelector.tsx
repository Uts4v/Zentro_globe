import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown } from "lucide-react";

export interface DateRange {
  dateFrom: string;
  dateTo: string;
  label: string;
}

const PRESETS: { label: string; getRange: () => { from: Date; to: Date } }[] = [
  {
    label: "Today",
    getRange: () => {
      const now = new Date();
      return { from: now, to: now };
    },
  },
  {
    label: "Yesterday",
    getRange: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return { from: d, to: d };
    },
  },
  {
    label: "This Week",
    getRange: () => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      return { from: start, to: now };
    },
  },
  {
    label: "Last Week",
    getRange: () => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay() - 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { from: start, to: end };
    },
  },
  {
    label: "This Month",
    getRange: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start, to: now };
    },
  },
  {
    label: "Last Month",
    getRange: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: start, to: end };
    },
  },
  {
    label: "This Quarter",
    getRange: () => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), q * 3, 1);
      return { from: start, to: now };
    },
  },
  {
    label: "Last Quarter",
    getRange: () => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), (q - 1) * 3, 1);
      const end = new Date(now.getFullYear(), q * 3, 0);
      return { from: start, to: end };
    },
  },
  {
    label: "This Year",
    getRange: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 1);
      return { from: start, to: now };
    },
  },
  {
    label: "Last Year",
    getRange: () => {
      const now = new Date();
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const end = new Date(now.getFullYear() - 1, 11, 31);
      return { from: start, to: end };
    },
  },
];

function toLocalDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateShort(d: string): string {
  const date = new Date(`${d}T12:00:00`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface DateRangeSelectorProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

export function DateRangeSelector({ value, onChange, className = "" }: DateRangeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCustomMode(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function applyPreset(preset: (typeof PRESETS)[number]) {
    const range = preset.getRange();
    onChange({
      dateFrom: toLocalDateStr(range.from),
      dateTo: toLocalDateStr(range.to),
      label: preset.label,
    });
    setOpen(false);
    setCustomMode(false);
  }

  function applyCustom() {
    setOpen(false);
    setCustomMode(false);
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
      >
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span>{value.label || "Select date range"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-2 w-72 rounded-2xl border border-border bg-card p-3 shadow-xl">
          {customMode ? (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Custom Range
              </p>
              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-[10px] text-muted-foreground">Start Date</label>
                  <input
                    type="date"
                    value={value.dateFrom}
                    max={value.dateTo}
                    onChange={(e) =>
                      onChange({ ...value, dateFrom: e.target.value, label: "Custom Range" })
                    }
                    className="w-full rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-muted-foreground">End Date</label>
                  <input
                    type="date"
                    value={value.dateTo}
                    min={value.dateFrom}
                    onChange={(e) =>
                      onChange({ ...value, dateTo: e.target.value, label: "Custom Range" })
                    }
                    className="w-full rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={applyCustom}
                  className="flex-1 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                >
                  Apply
                </button>
                <button
                  onClick={() => setCustomMode(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50"
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => applyPreset(preset)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    value.label === preset.label
                      ? "bg-ink text-white font-medium"
                      : "text-foreground hover:bg-muted/50"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <div className="my-1 border-t border-border" />
              <button
                onClick={() => setCustomMode(true)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted/50"
              >
                Custom Range...
              </button>
            </div>
          )}
        </div>
      )}

      {value.dateFrom && value.dateTo && !customMode && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {formatDateShort(value.dateFrom)} — {formatDateShort(value.dateTo)}
        </p>
      )}
    </div>
  );
}

export function getDefaultDateRange(): DateRange {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 29);
  return {
    dateFrom: toLocalDateStr(from),
    dateTo: toLocalDateStr(now),
    label: "Last 30 Days",
  };
}
