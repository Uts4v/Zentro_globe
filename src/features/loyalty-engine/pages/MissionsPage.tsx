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
        {loading && (
          <p className="text-center text-sm text-muted-foreground">Loading missions…</p>
        )}
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
            <article key={m.id} className="glass-strong rounded-3xl p-5">
              <div className="flex items-start gap-4">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-ember-soft text-3xl">
                  {m.icon || "🎯"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="truncate text-base font-semibold text-foreground">{m.title}</h3>
                    <span className="font-display shrink-0 text-lg text-ember">
                      {m.current_count}/{m.target_count}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
                  {m.linked_menu_item_name && (
                    <p className="mt-1 text-xs font-medium text-ember">Buy {m.linked_menu_item_name} {m.target_count}x</p>
                  )}
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-mist">
                    <div
                      className={`h-full rounded-full transition-all ${done ? "bg-slate-900 dark:bg-white" : "gradient-ember"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Reward · <span className="text-foreground">+{m.reward_points} pts</span>
                    </p>
                    {done && (
                      <span className="rounded-full bg-slate-900 dark:bg-white px-3 py-1 text-[10px] uppercase tracking-widest text-white dark:text-slate-900">
                        Completed ✓
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </MobileShell>
  );
}
