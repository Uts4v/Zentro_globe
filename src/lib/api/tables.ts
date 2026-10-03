import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";
import type { MerchantTable, TableResolution } from "./types";

export const tableApi = {
  list: async (): Promise<MerchantTable[]> => {
    return djangoFetch<MerchantTable[]>(apiUrl("/merchants/tables/"), {
      headers: authHeaders(),
    });
  },

  create: async (data: { name: string; table_number: number }): Promise<MerchantTable> => {
    return djangoFetch<MerchantTable>(apiUrl("/merchants/tables/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(data),
    });
  },

  update: async (id: number, data: Partial<MerchantTable>): Promise<MerchantTable> => {
    return djangoFetch<MerchantTable>(apiUrl(`/merchants/tables/${id}/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(data),
    });
  },

  delete: async (id: number): Promise<void> => {
    await djangoFetch(apiUrl(`/merchants/tables/${id}/delete/`), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },

  generate: async (count: number, namePrefix?: string): Promise<MerchantTable[]> => {
    return djangoFetch<MerchantTable[]>(apiUrl("/merchants/tables/generate/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ count, name_prefix: namePrefix ?? "Table" }),
    });
  },

  regenerateQR: async (id: number): Promise<MerchantTable> => {
    return djangoFetch<MerchantTable>(apiUrl(`/merchants/tables/${id}/regenerate-qr/`), {
      method: "POST",
      headers: authHeaders(true),
    });
  },

  resolve: async (slug: string | null | undefined, token: string): Promise<TableResolution> => {
    if (slug) {
      try {
        return await djangoFetch<TableResolution>(
          apiUrl(
            `/merchants/public/${encodeURIComponent(slug)}/tables/${encodeURIComponent(token)}/`,
          ),
        );
      } catch {
        // Fall back to token-only resolution if slug was invalid/outdated
        return await djangoFetch<TableResolution>(
          apiUrl(`/merchants/public/tables/${encodeURIComponent(token)}/`),
        );
      }
    }
    return djangoFetch<TableResolution>(
      apiUrl(`/merchants/public/tables/${encodeURIComponent(token)}/`),
    );
  },

  resolveByToken: async (token: string): Promise<TableResolution> => {
    return djangoFetch<TableResolution>(
      apiUrl(`/merchants/public/tables/${encodeURIComponent(token)}/`),
    );
  },
};
