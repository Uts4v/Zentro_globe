import { missionApi, type MissionView } from "@/lib/api";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { useEffect, useState } from "react";

export function MissionsPage() {
  const [missions, setMissions] = useState<MissionView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    missionApi
      .myMissions()
      .then(setMissions)
      .catch(() => setMissions([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <MobileShell>
      <TopBar />
      <div className="px-5">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">This month</p>
        <h1 className="font-display mt-1 text-4xl text-foreground">Missions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Small quests, real rewards. Refreshes every month.
        </p>
      </div>

      <div className="mt-6 space-y-3 px-5 pb-8">
        {loading && <p className="text-center text-sm text-muted-foreground">Loading missions…</p>}
        {!loading && missions.length === 0 && (
          <div className="glass rounded-3xl py-16 text-center">
            <p className="text-4xl">🎯</p>
            <p className="mt-3 text-sm text-muted-foreground">No missions available yet.</p>
          </div>
        )}
        {missions.map((m) => {
          const pct = Math.min((m.current_count / m.target_count) * 100, 100);
          const done = m.is_completed || m.current_count >= m.target_count;
          return (
            <article
              key={m.id}
              className="flex items-center gap-3.5 rounded-[26px] bg-card p-4 transition-all"
              style={{
                boxShadow: "var(--shadow-card)",
                border: "1px solid var(--border)",
              }}
            >
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-mist text-2xl">
                <span style={{ filter: "grayscale(1) brightness(0)" }}>{m.icon || "🎯"}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[14px] font-extrabold text-foreground">{m.title}</p>
                  {done ? (
                    <span className="shrink-0 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-extrabold text-white">
                      Done ✓
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-extrabold text-primary">
                      +{m.reward_points} pts
                    </span>
                  )}
                </div>
                {m.description && (
                  <p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">
                    {m.description}
                  </p>
                )}
                {m.linked_menu_item_name && (
                  <p className="mt-0.5 truncate text-[11px] font-medium text-ember">
                    Buy {m.linked_menu_item_name} {m.target_count}x
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        done ? "bg-emerald-500" : "gradient-ember"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[10px] font-extrabold text-muted-foreground">
                    {m.current_count}/{m.target_count}
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </MobileShell>
  );
}
