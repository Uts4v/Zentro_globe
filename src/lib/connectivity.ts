// src/lib/connectivity.ts
// Whether the Django server can be reached right now.
//
// `navigator.onLine` only says a network interface is up: a router whose
// uplink is dead still reports "online". So the outcome of every request is
// recorded here too — a request that got no answer marks the server
// unreachable, and any answer (even an error) marks it reachable again.

type Listener = () => void;
type Probe = () => Promise<Response>;

const PROBE_INTERVAL_MS = 10000;

const listeners = new Set<Listener>();
let serverReachable = true;
let probeRequest: Probe | null = null;
let probeTimer: ReturnType<typeof setInterval> | null = null;
let listeningToBrowser = false;

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * A proxy answering on behalf of a server that is down. The request got a
 * response, but not from the server, so it counts as unreachable.
 */
export function isGatewayError(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/** True when the server is expected to answer. */
export function isOnline(): boolean {
  return browserOnline() && serverReachable;
}

function notify() {
  listeners.forEach((fn) => fn());
}

function stopProbe() {
  if (probeTimer) clearInterval(probeTimer);
  probeTimer = null;
}

/** While unreachable, keep asking so the POS comes back without a reload. */
function syncProbe() {
  const needed = !serverReachable && listeners.size > 0 && browserOnline() && !!probeRequest;
  if (!needed) {
    stopProbe();
    return;
  }
  if (probeTimer) return;
  probeTimer = setInterval(probe, PROBE_INTERVAL_MS);
}

async function probe() {
  if (!probeRequest) return;
  try {
    // Any answer from the server itself will do, an error included.
    const res = await probeRequest();
    if (!isGatewayError(res.status)) noteServerReachable();
  } catch {
    // still unreachable
  }
}

/** The request to make while the server is unreachable, to see if it is back. */
export function setConnectivityProbe(request: Probe) {
  probeRequest = request;
}

export function noteServerReachable() {
  if (serverReachable) return;
  serverReachable = true;
  stopProbe();
  notify();
}

export function noteServerUnreachable() {
  if (!serverReachable) return;
  serverReachable = false;
  syncProbe();
  notify();
}

/** Ask now instead of waiting for the next probe (e.g. a "Try again" button). */
export function checkConnectivity(): Promise<void> {
  return serverReachable ? Promise.resolve() : probe();
}

function onBrowserOnline() {
  // The interface is back; assume the server is too. The next request (or the
  // probe) corrects this if the uplink is still dead.
  serverReachable = true;
  stopProbe();
  notify();
}

export function subscribeConnectivity(listener: Listener): () => void {
  listeners.add(listener);
  if (!listeningToBrowser && typeof window !== "undefined") {
    listeningToBrowser = true;
    window.addEventListener("online", onBrowserOnline);
    window.addEventListener("offline", notify);
  }
  syncProbe();
  return () => {
    listeners.delete(listener);
    syncProbe();
  };
}
