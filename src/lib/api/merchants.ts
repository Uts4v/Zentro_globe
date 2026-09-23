import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";
import type { MerchantProfile, MerchantDiscoveryItem } from "./types";

export const merchantApi = {
  me: async (): Promise<MerchantProfile> => {
    return djangoFetch<MerchantProfile>(apiUrl("/merchants/me/"), {
      headers: authHeaders(),
    });
  },

  list: async (): Promise<MerchantProfile[]> => {
    return djangoFetch<MerchantProfile[]>(apiUrl("/merchants/"));
  },

  /** Approved cafés within `radiusKm` of the point, nearest first, with `distance_km`. */
  nearby: async (lat: number, lng: number, radiusKm?: number): Promise<MerchantDiscoveryItem[]> => {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    if (radiusKm !== undefined) params.set("radius_km", String(radiusKm));
    return djangoFetch<MerchantDiscoveryItem[]>(apiUrl(`/merchants/nearby/?${params}`));
  },

  get: async (id: string): Promise<MerchantProfile> => {
    return djangoFetch<MerchantProfile>(apiUrl(`/merchants/${id}/`));
  },

  bySlug: async (slug: string): Promise<MerchantProfile> => {
    return djangoFetch<MerchantProfile>(apiUrl(`/merchants/slug/${encodeURIComponent(slug)}/`));
  },

  update: async (input: Partial<MerchantProfile>): Promise<MerchantProfile> => {
    return djangoFetch<MerchantProfile>(apiUrl("/merchants/me/update/"), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  regenerateQR: async (): Promise<{ qr_code: string }> => {
    return djangoFetch<{ qr_code: string }>(apiUrl("/merchants/me/regenerate-qr/"), {
      method: "POST",
      headers: authHeaders(true),
    });
  },
};
