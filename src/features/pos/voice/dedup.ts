/**
 * Remembers which ordering events have already been announced.
 *
 * Voice dedup is independent of print dedup: this only stops the same KOT or
 * order from being read aloud twice (e.g. because several polls see it, or the
 * terminal reloads mid-shift). Entries are in memory and mirrored to
 * localStorage so a reload does not replay the last few orders.
 */

const DEDUP_KEY = "pos_voice_dedup";
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

interface Entry {
  key: string;
  at: number;
}

function loadPersisted(): Entry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(DEDUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is Entry => !!e && typeof e.key === "string" && typeof (e as Entry).at === "number",
    );
  } catch {
    return [];
  }
}

export class DedupStore {
  private entries: Map<string, number>;
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.entries = new Map();
    for (const entry of loadPersisted()) {
      this.entries.set(entry.key, entry.at);
    }
    this.prune();
  }

  has(key: string): boolean {
    const at = this.entries.get(key);
    if (at === undefined) return false;
    if (this.now() - at > TTL_MS) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  add(key: string): void {
    this.entries.set(key, this.now());
    this.prune();
    this.persist();
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(DEDUP_KEY);
      } catch {
        // ignore
      }
    }
  }

  private prune(): void {
    const cutoff = this.now() - TTL_MS;
    for (const [key, at] of this.entries) {
      if (at < cutoff) this.entries.delete(key);
    }
    while (this.entries.size > MAX_ENTRIES) {
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [key, at] of this.entries) {
        if (at < oldestAt) {
          oldestAt = at;
          oldestKey = key;
        }
      }
      if (oldestKey === null) break;
      this.entries.delete(oldestKey);
    }
  }

  private persist(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const payload: Entry[] = Array.from(this.entries, ([key, at]) => ({ key, at }));
      localStorage.setItem(DEDUP_KEY, JSON.stringify(payload));
    } catch {
      // ignore — in-memory dedup still holds for this session.
    }
  }
}
