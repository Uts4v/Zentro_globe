/**
 * Who is this till, and may it talk to the server?
 *
 * A merchant signs their own phone in with their account. An employee signs
 * theirs in with a Staff Code + PIN and never sees those credentials — so
 * anything that only understands a merchant JWT strands every order a cashier
 * takes while the connection is down, waiting for a login that employee cannot
 * perform.
 *
 * The logic is here, with its storage and network access passed in, so the
 * decisions can be tested without a browser; `pos-auth.ts` supplies the real
 * ones. Both the headers a request carries and the answer to "may this device
 * send at all" now have a single definition.
 */

/** What a POS call needs to authenticate, as read from this device. */
export interface PosIdentity {
  /** Merchant access token, when the owner is signed in on this device. */
  access: string | null;
  /** Merchant refresh token, or null. */
  refresh: string | null;
  /** The employee's scoped staff token, from Staff Code + PIN sign-in. */
  staffToken: string | null;
  /** The registered till, so a request identifies its merchant even unsigned. */
  deviceId: string | null;
  deviceToken: string | null;
}

/** Where `posAuthHeaders` gets its answers from. */
export interface PosIdentitySource {
  read(): PosIdentity;
}

/** What `posSessionState` needs beyond the identity. */
export interface PosSessionDeps extends PosIdentitySource {
  /** Seconds until `token` expires; negative when already expired. */
  secondsUntilExpiry(token: string): number;
  /** Exchange the refresh token for a new pair. */
  refresh(): Promise<"refreshed" | "rejected" | "unreachable">;
}

export type SessionState = "ok" | "offline" | "signed_out";

/**
 * Auth for a POS request.
 *
 * Two identities, sent together when both exist:
 *   - `Authorization`: the merchant access token when the owner is signed in on
 *     this device, otherwise the employee's staff token. The POS accepts a staff
 *     token on its own (`pos.authentication.StaffTokenAuthentication`).
 *   - `X-Pos-Device-Id` / `X-Pos-Device-Token`: the registered till, so a
 *     request still identifies the right merchant when no session is loaded.
 *
 * `X-Zentro-Staff` is what lets the server attribute the change to the right
 * employee rather than to the merchant owner.
 */
export function posAuthHeaders(read: PosIdentitySource["read"]): Record<string, string> {
  const { access, staffToken, deviceId, deviceToken } = read();
  const authorization = access ? `Bearer ${access}` : staffToken ? `Staff ${staffToken}` : "";

  return {
    ...(authorization ? { Authorization: authorization } : {}),
    "Content-Type": "application/json",
    ...(staffToken ? { "X-Zentro-Staff": staffToken } : {}),
    ...(deviceId ? { "X-Pos-Device-Id": deviceId } : {}),
    ...(deviceToken ? { "X-Pos-Device-Token": deviceToken } : {}),
  };
}

/**
 * Whether this till is allowed to send queued work at all.
 *
 * A merchant access token is one way in. So is an employee signed in with a
 * Staff Code + PIN, which is how a shared till works: requiring the owner's
 * token here is what left a staff-only terminal holding its offline orders
 * forever, since the remedy it asked for was a login no employee can perform.
 *
 * Returns "offline" only when the server is genuinely unreachable, so the queue
 * is retried later rather than marked as needing attention.
 */
export async function posSessionState(deps: PosSessionDeps): Promise<SessionState> {
  // Signed in as an employee: their staff token authenticates the request on
  // its own, so there is nothing to refresh.
  const { access, refresh, staffToken, deviceId, deviceToken } = deps.read();
  if (staffToken) return "ok";

  if (access && deps.secondsUntilExpiry(access) > 30) return "ok";

  // Only attempt a refresh when there is a refresh token to use. Without one
  // the call answers "rejected" immediately, which would report a signed-out
  // till for a device that is perfectly able to sync.
  if (refresh) {
    const outcome = await deps.refresh();
    if (outcome === "refreshed") return "ok";
    return outcome === "unreachable" ? "offline" : "signed_out";
  }

  // No merchant session and nothing to refresh. A registered device is
  // authorised on its own — that is what lets a till work after its owner's
  // tokens are gone. With no identity at all there is nothing to authenticate
  // with, so the queue has to wait for a sign-in.
  return deviceId && deviceToken ? "ok" : "signed_out";

  const outcome = await deps.refresh();
  if (outcome === "refreshed") return "ok";
  return outcome === "unreachable" ? "offline" : "signed_out";
}
