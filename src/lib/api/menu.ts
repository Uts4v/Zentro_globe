import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";
import type {
  MenuCatalog,
  MenuCategory,
  MenuItem,
  MenuItemInput,
  MenuOption,
  MenuOptionGroup,
} from "./types";

type CatalogFilters = { q?: string; category_id?: number | string; available_only?: boolean };

export const menuApi = {
  myItems: async (): Promise<MenuItem[]> => {
    return djangoFetch<MenuItem[]>(apiUrl("/merchants/menu-items/my-items/"), {
      headers: authHeaders(),
    });
  },

  create: async (input: Partial<MenuItemInput>): Promise<MenuItem> => {
    return djangoFetch<MenuItem>(apiUrl("/merchants/menu-items/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  update: async (id: string, input: Partial<MenuItemInput>): Promise<MenuItem> => {
    return djangoFetch<MenuItem>(apiUrl(`/merchants/menu-items/${id}/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  delete: async (id: string): Promise<void> => {
    return djangoFetch<void>(apiUrl(`/merchants/menu-items/${id}/`), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },

  toggleAvailability: async (id: string): Promise<MenuItem> => {
    return djangoFetch<MenuItem>(apiUrl(`/merchants/menu-items/${id}/toggle-availability/`), {
      method: "PATCH",
      headers: authHeaders(),
    });
  },

  forMerchant: async (merchantId: string | number): Promise<MenuItem[]> => {
    return djangoFetch<MenuItem[]>(apiUrl(`/merchants/${merchantId}/menu/`));
  },

  /** Rich public catalog — merchant + categories + items with option groups. */
  catalog: async (merchantId: string | number, filters?: CatalogFilters): Promise<MenuCatalog> => {
    const params = new URLSearchParams();
    if (filters?.q) params.set("q", filters.q);
    if (filters?.category_id != null) params.set("category_id", String(filters.category_id));
    if (filters?.available_only) params.set("available_only", "1");
    const qs = params.toString();
    return djangoFetch<MenuCatalog>(
      apiUrl(`/merchants/${merchantId}/menu/catalog/${qs ? `?${qs}` : ""}`),
    );
  },

  // ── Menu categories ─────────────────────────────────────────────────────────
  categories: async (): Promise<MenuCategory[]> => {
    return djangoFetch<MenuCategory[]>(apiUrl("/merchants/categories/"), {
      headers: authHeaders(),
    });
  },

  createCategory: async (input: Partial<MenuCategory>): Promise<MenuCategory> => {
    return djangoFetch<MenuCategory>(apiUrl("/merchants/categories/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  updateCategory: async (id: string, input: Partial<MenuCategory>): Promise<MenuCategory> => {
    return djangoFetch<MenuCategory>(apiUrl(`/merchants/categories/${id}/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  deleteCategory: async (id: string): Promise<void> => {
    return djangoFetch<void>(apiUrl(`/merchants/categories/${id}/`), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },

  reorderCategories: async (order: number[]): Promise<void> => {
    return djangoFetch<void>(apiUrl("/merchants/categories/reorder/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ order }),
    });
  },

  // ── Option groups (variants / modifiers) ────────────────────────────────────
  optionGroups: async (menuItemId: string | number): Promise<MenuOptionGroup[]> => {
    return djangoFetch<MenuOptionGroup[]>(
      apiUrl(`/merchants/menu-items/${menuItemId}/option-groups/`),
      {
        headers: authHeaders(),
      },
    );
  },

  createOptionGroup: async (
    menuItemId: string | number,
    input: Partial<MenuOptionGroup>,
  ): Promise<MenuOptionGroup> => {
    return djangoFetch<MenuOptionGroup>(
      apiUrl(`/merchants/menu-items/${menuItemId}/option-groups/`),
      {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(input),
      },
    );
  },

  updateOptionGroup: async (
    menuItemId: string | number,
    groupId: string | number,
    input: Partial<MenuOptionGroup>,
  ): Promise<MenuOptionGroup> => {
    return djangoFetch<MenuOptionGroup>(
      apiUrl(`/merchants/menu-items/${menuItemId}/option-groups/${groupId}/`),
      {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify(input),
      },
    );
  },

  deleteOptionGroup: async (
    menuItemId: string | number,
    groupId: string | number,
  ): Promise<void> => {
    return djangoFetch<void>(
      apiUrl(`/merchants/menu-items/${menuItemId}/option-groups/${groupId}/`),
      { method: "DELETE", headers: authHeaders() },
    );
  },

  addOption: async (
    menuItemId: string | number,
    groupId: string | number,
    input: Partial<MenuOption>,
  ): Promise<MenuOption> => {
    return djangoFetch<MenuOption>(
      apiUrl(`/merchants/menu-items/${menuItemId}/option-groups/${groupId}/options/`),
      {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(input),
      },
    );
  },

  updateOption: async (
    menuItemId: string | number,
    groupId: string | number,
    optionId: string | number,
    input: Partial<MenuOption>,
  ): Promise<MenuOption> => {
    return djangoFetch<MenuOption>(
      apiUrl(`/merchants/menu-items/${menuItemId}/option-groups/${groupId}/options/${optionId}/`),
      {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify(input),
      },
    );
  },

  deleteOption: async (
    menuItemId: string | number,
    groupId: string | number,
    optionId: string | number,
  ): Promise<void> => {
    return djangoFetch<void>(
      apiUrl(`/merchants/menu-items/${menuItemId}/option-groups/${groupId}/options/${optionId}/`),
      { method: "DELETE", headers: authHeaders() },
    );
  },
};
