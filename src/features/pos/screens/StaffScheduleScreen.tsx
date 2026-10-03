import { useEffect, useState } from "react";
import { usePosStore } from "../store";
import {
  posListSchedules,
  posCreateSchedule,
  posDeleteSchedule,
  PosStaffSchedule,
  ShiftWorker,
} from "../api";
import {
  Calendar,
  Plus,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
} from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function StaffScheduleScreen() {
  const workers = usePosStore((s) => s.workers);
  const [schedules, setSchedules] = useState<PosStaffSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [newWorkerId, setNewWorkerId] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("17:00");
  const [newRole, setNewRole] = useState("cashier");
  const [creating, setCreating] = useState(false);

  // Calculate week dates
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1 + weekOffset * 7);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const weekStr = weekDates[0].toISOString().split("T")[0];

  useEffect(() => {
    loadSchedules();
  }, [weekOffset]);

  async function loadSchedules() {
    setLoading(true);
    try {
      const data = await posListSchedules(weekStr);
      setSchedules(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newWorkerId || !newDate || !newStart || !newEnd) return;
    setCreating(true);
    try {
      await posCreateSchedule({
        worker_id: newWorkerId,
        shift_date: newDate,
        start_time: newStart,
        end_time: newEnd,
        role: newRole,
      });
      setShowAdd(false);
      setNewWorkerId("");
      setNewDate("");
      setNewStart("09:00");
      setNewEnd("17:00");
      await loadSchedules();
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await posDeleteSchedule(id);
      await loadSchedules();
    } catch {
      // ignore
    }
  }

  function getSchedulesForDate(date: Date) {
    const dateStr = date.toISOString().split("T")[0];
    return schedules.filter((s) => s.shift_date === dateStr);
  }

  return (
    <div className="mx-auto max-w-5xl p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-ink" />
          <h1 className="text-xl font-bold text-foreground">Staff Schedule</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[120px] text-center text-sm font-medium text-foreground">
            {weekDates[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} —{" "}
            {weekDates[6].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-muted"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Add Shift
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {weekDates.map((date, i) => {
            const daySchedules = getSchedulesForDate(date);
            const isToday = date.toISOString().split("T")[0] === today.toISOString().split("T")[0];
            return (
              <div
                key={i}
                className={`rounded-2xl border bg-card p-2 min-h-[200px] ${
                  isToday ? "border-ink ring-1 ring-ink" : "border-border"
                }`}
              >
                <div className="mb-2 text-center">
                  <p className="text-[10px] text-muted-foreground">{DAYS[i]}</p>
                  <p className={`text-lg font-bold ${isToday ? "text-ink" : "text-foreground"}`}>
                    {date.getDate()}
                  </p>
                </div>
                <div className="space-y-1.5">
                  {daySchedules.length === 0 ? (
                    <p className="py-4 text-center text-[10px] text-muted-foreground">No shifts</p>
                  ) : (
                    daySchedules.map((s) => (
                      <div
                        key={s.id}
                        className="group relative rounded-xl bg-muted/50 p-1.5 text-[10px]"
                      >
                        <p className="font-medium text-foreground truncate">{s.worker_name}</p>
                        <p className="text-muted-foreground">
                          {s.start_time}—{s.end_time}
                        </p>
                        <button
                          onClick={() => handleDelete(s.id)}
                          className="absolute right-1 top-1 hidden rounded p-0.5 text-red-500 hover:bg-red-50 group-hover:block"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add shift modal */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-lg font-bold text-foreground">Add Shift</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Worker
                </label>
                <select
                  value={newWorkerId}
                  onChange={(e) => setNewWorkerId(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                >
                  <option value="">Select worker...</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.display_name} ({w.role})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Date</label>
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Start
                  </label>
                  <input
                    type="time"
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    End
                  </label>
                  <input
                    type="time"
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                >
                  <option value="cashier">Cashier</option>
                  <option value="waiter">Waiter</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 border-t border-border px-5 py-4">
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newWorkerId || !newDate || creating}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
