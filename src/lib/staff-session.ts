// src/lib/staff-session.ts
// Staff mode: an employee using the merchant dashboard or POS on a shared device.
// The token only names the employee; the server reads their role on every
// request, so nothing here grants access — it only identifies who is acting.

export interface StaffSession {
  token: string;
  name: string;
  role: string;
  workerId?: string;
  staffCode?: string;
  permissions?: string[];
  merchantSlug?: string;
  merchantName?: string;
}

const STAFF_KEY = "zentro.staff";
const LEGACY_KEY = "zentro.inventory.staff";
type Listener = () => void;
const listeners = new Set<Listener>();

function read(): StaffSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STAFF_KEY) ?? localStorage.getItem(LEGACY_KEY);
    return raw ? (JSON.parse(raw) as StaffSession) : null;
  } catch {
    return null;
  }
}

export const staffSession = {
  get: read,
  set(value: StaffSession | null) {
    try {
      localStorage.removeItem(LEGACY_KEY);
      if (value) localStorage.setItem(STAFF_KEY, JSON.stringify(value));
      else localStorage.removeItem(STAFF_KEY);
    } catch {
      /* storage unavailable: staff mode lasts for this page only */
    }
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/** Header that tells the server which employee is acting (if any). */
export function staffHeaders(): Record<string, string> {
  const token = read()?.token;
  return token ? { "X-Zentro-Staff": token } : {};
}

/** Check if the currently logged-in staff member has a specific permission.
 * If no staff session is active (e.g. merchant owner logged in directly), returns true.
 */
export function hasStaffPermission(permCode: string): boolean {
  const session = read();
  if (!session || !session.permissions) return true; // Merchant owner or admin session
  return session.permissions.includes(permCode);
}

