import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";
import type { Mission, MissionView } from "./types";

export const missionApi = {
  myMissions: async (merchantId?: string): Promise<MissionView[]> => {
    const qs = merchantId ? `?merchant=${merchantId}` : "";
    return djangoFetch<MissionView[]>(apiUrl(`/loyalty/missions/my-missions/${qs}`), {
      headers: authHeaders(),
    });
  },

  merchantMissions: async (): Promise<Mission[]> => {
    return djangoFetch<Mission[]>(apiUrl("/loyalty/missions/merchant/"), {
      headers: authHeaders(),
    });
  },

  create: async (input: Omit<Mission, "id" | "merchant_id" | "created_at" | "linked_menu_item_name">): Promise<Mission> => {
    return djangoFetch<Mission>(apiUrl("/loyalty/missions/create/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  update: async (id: string, input: Partial<Mission>): Promise<Mission> => {
    return djangoFetch<Mission>(apiUrl(`/loyalty/missions/${id}/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  delete: async (id: string): Promise<void> => {
    return djangoFetch<void>(apiUrl(`/loyalty/missions/${id}/`), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },
};
