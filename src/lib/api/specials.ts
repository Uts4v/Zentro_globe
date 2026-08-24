import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";
import type { TodaySpecial } from "./types";

export const specialApi = {
  forSlug: async (slug: string): Promise<TodaySpecial[]> => {
    const data = await djangoFetch<TodaySpecial[]>(apiUrl(`/loyalty/specials/${slug}/`));
    return data ?? [];
  },

  list: async (): Promise<TodaySpecial[]> => {
    return djangoFetch<TodaySpecial[]>(apiUrl("/loyalty/merchant/specials/"), {
      headers: authHeaders(),
    });
  },

  create: async (input: Partial<TodaySpecial>): Promise<TodaySpecial> => {
    return djangoFetch<TodaySpecial>(apiUrl("/loyalty/merchant/specials/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  update: async (id: string, input: Partial<TodaySpecial>): Promise<TodaySpecial> => {
    return djangoFetch<TodaySpecial>(apiUrl(`/loyalty/merchant/specials/${id}/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  delete: async (id: string): Promise<void> => {
    return djangoFetch<void>(apiUrl(`/loyalty/merchant/specials/${id}/`), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },
};
