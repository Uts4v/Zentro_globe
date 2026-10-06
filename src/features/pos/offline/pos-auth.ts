/**
 * Auth for POS requests and the "may this till talk to the server?" decision.
 *
 * The rules live in `pos-auth-core.ts`, which takes its storage and network
 * access as arguments so they can be tested without a browser. This module is
 * the binding that supplies the real ones.
 */

import { tokenStore } from "@/lib/django-api-base";
import { refreshAccessToken, secondsUntilExpiry } from "@/lib/auth-tokens";
import { staffSession } from "@/lib/staff-session";
import {
  posAuthHeaders as buildAuthHeaders,
  posSessionState as decideSessionState,
  type PosIdentity,
  type SessionState,
} from "./pos-auth-core";

export type { SessionState };

/** The two identities a till can hold, read from this device. */
export function readPosIdentity(): PosIdentity {
  return {
    access: tokenStore.getAccess(),
    refresh: tokenStore.getRefresh(),
    staffToken: staffSession.get()?.token ?? null,
    deviceId: localStorage.getItem("pos_device_id"),
    deviceToken: localStorage.getItem("pos_device_token"),
  };
}

export const posAuthHeaders = (): Record<string, string> => buildAuthHeaders(readPosIdentity);

export const posSessionState = (): Promise<SessionState> =>
  decideSessionState({
    read: readPosIdentity,
    secondsUntilExpiry,
    refresh: refreshAccessToken,
  });
