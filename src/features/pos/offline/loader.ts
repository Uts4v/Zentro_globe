/**
 * One place that knows how to get live POS data onto a till.
 *
 * The bug this replaces: each screen that needed POS data built its own
 * fallback chain, and the chain deleted the device registration whenever the
 * last attempt failed — including when it failed only because the network was
 * down. One offline page load was enough to un-register the till, after which
 * every later load had nothing to authenticate with and the POS was stuck on
 * whatever copy it had saved, forever.
 */

import {
  posAuthorizeDevice,
  posBootstrap,
  posDeviceBootstrap,
  type PosBootstrapResponse,
} from "../api";
import { isConnectionError } from "../store";
import { loadSavedBootstrap, saveSavedBootstrap, savedMerchantId } from "./cache";

/** Where a POS screen's data came from. */
export type BootstrapSource = "network" | "saved";

/**
 * Window event asking the POS layout to pull fresh data from the server.
 *
 * A window event rather than a prop so the grid stays a plain store consumer:
 * whichever screen holds the refresh routine, any screen can ask for it.
 */
export const POS_REFRESH_EVENT = "zentro:pos-refresh";

export function requestPosRefresh(): void {
  window.dispatchEvent(new Event(POS_REFRESH_EVENT));
}

export interface LoadedBootstrap {
  data: PosBootstrapResponse;
  source: BootstrapSource;
  /** When the saved copy was saved on this device. Null for live data. */
  savedAt: string | null;
}

function storeDeviceCredentials(device: { id: string }, token: string): void {
  localStorage.setItem("pos_device_id", device.id);
  localStorage.setItem("pos_device_token", token);
}

function clearDeviceCredentials(): void {
  localStorage.removeItem("pos_device_id");
  localStorage.removeItem("pos_device_token");
}

/**
 * Fetch the POS snapshot from the server, using whatever this device holds.
 *
 * Tries, in order: the device token (works with no merchant session — the
 * normal till), the merchant session, then a fresh device registration. A
 * connection failure stops the chain immediately and is rethrown: the network
 * being down is not evidence that any credential is bad, so nothing is
 * discarded and no further request is wasted on a round trip that cannot land.
 */
export async function fetchLiveBootstrap(): Promise<PosBootstrapResponse> {
  const deviceId = localStorage.getItem("pos_device_id");
  const deviceToken = localStorage.getItem("pos_device_token");
  let lastServerError: unknown = null;

  if (deviceId && deviceToken) {
    try {
      return await posDeviceBootstrap(deviceId, deviceToken);
    } catch (err) {
      if (isConnectionError(err)) throw err;
      // The server answered and refused the token. Fall through to the session.
      lastServerError = err;
    }
  }

  if (deviceId) {
    try {
      return await posBootstrap(deviceId);
    } catch (err) {
      if (isConnectionError(err)) throw err;
      lastServerError = err;
    }
  }

  // Nothing this device holds works. Registering a new device needs a merchant
  // session, which is the one case where clearing the stale credentials is safe
  // — we only get here having heard from the server.
  clearDeviceCredentials();
  try {
    const platform = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop";
    const result = await posAuthorizeDevice(
      `POS-${platform}-${Date.now()}`,
      platform,
      navigator.userAgent,
    );
    storeDeviceCredentials(result.device, result.device_token);
    return await posBootstrap(result.device.id);
  } catch (err) {
    // Keep the original refusal: it names the real problem (bad session, POS
    // disabled, no staff), while this error is usually "you are offline".
    throw isConnectionError(err) || lastServerError === null ? err : lastServerError;
  }
}

/**
 * Load the POS, falling back to this device's saved copy.
 *
 * The saved copy is used only when the server cannot be reached. A response
 * from the server — even an error — is reported instead: quietly substituting
 * stale data for a broken registration is how a till ends up taking orders
 * against a menu the merchant changed weeks ago.
 */
export async function loadPosBootstrap(): Promise<LoadedBootstrap> {
  try {
    const data = await fetchLiveBootstrap();
    saveSavedBootstrap(data.merchant?.id, data);
    return { data, source: "network", savedAt: null };
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    const saved = loadSavedBootstrap(savedMerchantId());
    if (!saved) throw err;
    return { data: saved.data, source: "saved", savedAt: saved.savedAt };
  }
}
