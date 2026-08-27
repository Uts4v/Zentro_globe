import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";

export const analyticsApi = {
  merchant: async (days?: number, dateFrom?: string, dateTo?: string) => {
    const params = new URLSearchParams();
    if (dateFrom && dateTo) {
      params.set("date_from", dateFrom);
      params.set("date_to", dateTo);
    } else {
      params.set("days", String(days ?? 30));
    }
    return djangoFetch<any>(apiUrl(`/merchants/analytics/?${params.toString()}`), {
      headers: authHeaders(),
    });
  },
};
