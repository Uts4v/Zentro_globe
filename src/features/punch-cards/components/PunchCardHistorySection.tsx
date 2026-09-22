import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Flag,
  Stamp,
  Gift,
  CheckCircle2,
  RotateCw,
  Search,
  Loader2,
  Users,
} from "lucide-react";
import {
  punchCardApi,
  type PunchCardHistory,
  type PunchCardEvent,
  type PunchCardEventType,
} from "@/lib/api";
import { EmptyState, ErrorBanner } from "@/components/LoyaltyShared";

const EVENT_META: Record<
  PunchCardEventType,
  { label: string; icon: React.ComponentType<{ className?: string }>; chip: string; dot: string }
> = {
  STARTED: {
    label: "Started",
    icon: Flag,
    chip: "bg-teal-50 text-teal-700 ring-teal-200",
    dot: "bg-teal-500",
  },
  PUNCHED: {
    label: "Punch",
    icon: Stamp,
    chip: "bg-ink/5 text-ink ring-ink/10",
    dot: "bg-ink",
  },
  COMPLETED: {
    label: "Completed",
    icon: CheckCircle2,
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  REDEEMED: {
    label: "Claimed",
    icon: Gift,
    chip: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
};

type CardGroup = {
  card_id: number;
  card_name: string;
  stamps_required: number;
  card_state: PunchCardEvent["card_state"];
  events: PunchCardEvent[];
};

type CustomerGroup = {
  customer_id: number;
  customer_name: string;
  cards: CardGroup[];
};

function groupEvents(events: PunchCardEvent[]): CustomerGroup[] {
  const customers = new Map<number, CustomerGroup>();
  // Events arrive newest-first from the API; group them and keep descending order.
  for (const ev of events) {
    let cust = customers.get(ev.customer_id);
    if (!cust) {
      cust = { customer_id: ev.customer_id, customer_name: ev.customer_name, cards: [] };
      customers.set(ev.customer_id, cust);
    }
    let card = cust.cards.find((c) => c.card_id === ev.card_id);
    if (!card) {
      card = {
        card_id: ev.card_id,
        card_name: ev.card_name,
        stamps_required: ev.stamps_required,
        card_state: ev.card_state,
        events: [],
      };
      cust.cards.push(card);
    }
    card.events.push(ev);
  }
  for (const cust of customers.values()) {
    for (const card of cust.cards) {
      // Timeline reads oldest → newest inside each card.
      card.events.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    }
  }
  return Array.from(customers.values());
}

function CardStateChip({
  state,
  stampsRequired,
}: {
  state: PunchCardEvent["card_state"];
  stampsRequired: number;
}) {
  if (state.is_redeemed) {
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
        Claimed {state.redeemed_at ? `· ${new Date(state.redeemed_at).toLocaleDateString()}` : ""}
      </span>
    );
  }
  if (state.is_completed) {
    return (
      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
        Completed · ready to claim
      </span>
    );
  }
  return (
    <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[10px] font-bold text-teal-700 ring-1 ring-teal-200">
      In progress · {state.current_stamps}/{stampsRequired}
    </span>
  );
}

function Timeline({ events }: { events: PunchCardEvent[] }) {
  return (
    <ol className="relative ml-2 space-y-5 border-l-2 border-border/60 pl-5">
      {events.map((ev) => {
        const meta = EVENT_META[ev.event_type];
        const Icon = meta.icon;
        const stamp =
          ev.event_type === "PUNCHED" && ev.stamp_number != null
            ? ` · stamp ${ev.stamp_number}${ev.stamps_required ? `/${ev.stamps_required}` : ""}`
            : "";
        return (
          <li key={ev.id} className="relative">
            <span
              className={`absolute -left-[27px] top-0.5 grid h-5 w-5 place-items-center rounded-full ring-4 ring-background ${meta.dot}`}
            >
              <Icon className="h-3 w-3 text-white" />
            </span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${meta.chip}`}
              >
                {meta.label}
              </span>
              {stamp && (
                <span className="text-[11px] font-medium text-muted-foreground">{stamp}</span>
              )}
              <span className="text-[11px] text-muted-foreground">
                {new Date(ev.created_at).toLocaleString()}
              </span>
              {ev.order_id != null && (
                <span className="text-[11px] text-muted-foreground">· Order #{ev.order_id}</span>
              )}
            </div>
            {ev.note && <p className="mt-0.5 text-xs text-muted-foreground">{ev.note}</p>}
          </li>
        );
      })}
    </ol>
  );
}

const FILTERS: { key: "ALL" | PunchCardEventType; label: string }[] = [
  { key: "ALL", label: "All activity" },
  { key: "STARTED", label: "Started" },
  { key: "PUNCHED", label: "Punches" },
  { key: "COMPLETED", label: "Completed" },
  { key: "REDEEMED", label: "Claimed" },
];

export function PunchCardHistorySection() {
  const [data, setData] = useState<PunchCardHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"ALL" | PunchCardEventType>("ALL");
  const [cardFilter, setCardFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load(nextFilter = filter, nextCard = cardFilter, nextSearch = search) {
    setLoading(true);
    setError("");
    try {
      const res = await punchCardApi.history({
        event_type: nextFilter === "ALL" ? undefined : nextFilter,
        card: nextCard === "all" ? undefined : nextCard,
        customer: nextSearch.trim() || undefined,
      });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load punch card history");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("ALL", "all", "").catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      load().catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, cardFilter, search]);

  const groups = useMemo(() => groupEvents(data?.events ?? []), [data]);

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const summary = data?.summary;
  const stats: {
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { label: "Active customers", value: summary?.customers_active ?? 0, icon: Users },
    { label: "Cards started", value: summary?.cards_started ?? 0, icon: Flag },
    { label: "Punches awarded", value: summary?.punches_awarded ?? 0, icon: Stamp },
    { label: "Completed", value: summary?.cards_completed ?? 0, icon: CheckCircle2 },
    { label: "Claims", value: summary?.claimed ?? 0, icon: Gift },
  ];

  return (
    <div className="glass-strong rounded-3xl p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-foreground">Punch Card History</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Every customer's stamp journey — when a card started, each punch, and when rewards were
            claimed.
          </p>
        </div>
        <button
          onClick={() => load().catch(() => {})}
          disabled={loading}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-4 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <RotateCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {/* Summary stats */}
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-border bg-background px-3 py-3">
            <Icon className="h-4 w-4 text-ember" />
            <p className="mt-1.5 font-display text-xl font-bold text-foreground">{value}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f.key
                  ? "bg-ink text-white"
                  : "border border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={cardFilter}
            onChange={(e) => setCardFilter(e.target.value)}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
          >
            <option value="all">All card templates</option>
            {(data?.cards ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer…"
              className="w-44 rounded-full border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
          </label>
        </div>
      </div>

      {/* Content */}
      <div className="mt-5">
        {loading ? (
          <div className="flex justify-center py-14">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon="🎟️"
            title="No punch card activity yet"
            sub="History appears here once customers start earning stamps."
          />
        ) : (
          <div className="space-y-3">
            {groups.map((cust) => {
              const isOpen = expanded.has(`c-${cust.customer_id}`);
              return (
                <div
                  key={cust.customer_id}
                  className="overflow-hidden rounded-2xl border border-border bg-background"
                >
                  <button
                    onClick={() => toggleExpand(`c-${cust.customer_id}`)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-mist/50 transition-colors"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-white">
                        {cust.customer_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {cust.customer_name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {cust.cards.length} card{cust.cards.length === 1 ? "" : "s"} ·{" "}
                          {cust.cards.reduce(
                            (sum, c) =>
                              sum + c.events.filter((e) => e.event_type === "PUNCHED").length,
                            0,
                          )}{" "}
                          stamps
                        </p>
                      </div>
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {isOpen && (
                    <div className="space-y-5 border-t border-border/60 px-4 py-4">
                      {cust.cards.map((card) => (
                        <div key={card.card_id} className="rounded-2xl bg-mist/50 p-4">
                          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground">
                                {card.card_name}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Started {new Date(card.card_state.started_at).toLocaleDateString()}
                              </p>
                            </div>
                            <CardStateChip
                              state={card.card_state}
                              stampsRequired={card.stamps_required}
                            />
                          </div>
                          <Timeline events={card.events} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
