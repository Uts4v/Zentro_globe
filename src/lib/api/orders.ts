import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";
import type {
  Order,
  CreateOrderPayload,
  CreateGuestOrderPayload,
  OrderStatus,
  OrderPreview,
  MenuSelection,
} from "./types";

/** Normalise a Django Order response into the shape the frontend expects. */
/* eslint-disable @typescript-eslint/no-explicit-any */
function normaliseOrder(o: any): Order {
  const items = (o.items ?? o.order_items ?? []).map((item: any) => ({
    ...item,
    id: String(item.id ?? ""),
    order_id: String(item.order_id ?? o.id ?? ""),
    menu_item_id: String(item.menu_item_id ?? item.menu_item ?? ""),
    options: item.options ?? [],
    special_instructions: item.special_instructions ?? "",
  }));

  // For guest orders, customer_name comes from guest_name_snapshot
  const customerName = o.customer_name ?? o.guest_name_snapshot ?? null;

  return {
    ...o,
    id: String(o.id),
    customer_id: String(o.customer_id ?? o.customer ?? ""),
    merchant_id: String(o.merchant_id ?? o.merchant ?? ""),
    fulfillment_type: o.fulfillment_type ?? "pickup",
    table_id: o.table_id ?? o.table ?? null,
    table_name_snapshot: o.table_name_snapshot ?? "",
    table_number_snapshot: o.table_number_snapshot ?? null,
    guest_session_id: o.guest_session_id ?? "",
    guest_name_snapshot: o.guest_name_snapshot ?? "",
    kot_number: o.kot_number ?? null,
    order_items: items,
    profiles: { full_name: customerName },
    merchant_profiles: { business_name: o.merchant_name ?? "" },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const orderApi = {
  callWaiter: async (payload: {
    merchant_id: string;
    table_token: string;
    guest_name?: string;
  }): Promise<{ message: string; delivered: boolean; cooldown?: boolean }> => {
    return djangoFetch<{ message: string; delivered: boolean; cooldown?: boolean }>(
      apiUrl("/orders/call-waiter/"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  },

  cancelByMerchant: async (id: string, reason: string): Promise<Order> => {
    const data = await djangoFetch<unknown>(apiUrl(`/orders/${id}/cancel/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify({ reason }),
    });
    return normaliseOrder(data);
  },

  myOrders: async (): Promise<Order[]> => {
    const data = await djangoFetch<unknown[]>(apiUrl("/orders/my-orders/"), {
      headers: authHeaders(),
    });
    return data.map(normaliseOrder);
  },

  storeOrders: async (filterStatus?: string): Promise<Order[]> => {
    const qs = filterStatus ? `?status=${filterStatus}` : "";
    const data = await djangoFetch<unknown[]>(apiUrl(`/orders/store-orders/${qs}`), {
      headers: authHeaders(),
    });
    return data.map(normaliseOrder);
  },

  create: async (payload: CreateOrderPayload): Promise<Order> => {
    const body = {
      merchant_id: payload.merchant_id,
      items: payload.items.map((i) => ({
        menu_item_id: i.menu_item_id,
        quantity: i.quantity,
        selections: i.selections ?? [],
        special_instructions: i.special_instructions ?? "",
      })),
      notes: payload.notes ?? "",
      fulfillment_type: payload.fulfillment_type ?? "pickup",
      table_token: payload.table_token ?? "",
    };
    const data = await djangoFetch<unknown>(apiUrl("/orders/create/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(body),
    });
    return normaliseOrder(data);
  },

  createGuest: async (payload: CreateGuestOrderPayload): Promise<Order> => {
    const body = {
      merchant_id: payload.merchant_id,
      items: payload.items.map((i) => ({
        menu_item_id: i.menu_item_id,
        quantity: i.quantity,
        selections: i.selections ?? [],
        special_instructions: i.special_instructions ?? "",
      })),
      notes: payload.notes ?? "",
      table_token: payload.table_token,
      guest_session_id: payload.guest_session_id,
      guest_name: payload.guest_name,
    };
    const data = await djangoFetch<unknown>(apiUrl("/orders/guest-create/"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return normaliseOrder(data);
  },

  /** Server-authoritative order preview (customer cart review / price guard). */
  preview: async (payload: {
    merchant_id: string;
    items: CreateOrderPayload["items"];
  }): Promise<OrderPreview> => {
    return djangoFetch<OrderPreview>(apiUrl("/orders/preview/"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: payload.merchant_id,
        items: payload.items.map((i) => ({
          menu_item_id: i.menu_item_id,
          quantity: i.quantity,
          selections: i.selections ?? [],
          special_instructions: i.special_instructions ?? "",
        })),
      }),
    });
  },

  updateStatus: async (id: string, status: OrderStatus): Promise<Order> => {
    const data = await djangoFetch<unknown>(apiUrl(`/orders/${id}/update-status/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify({ status }),
    });
    return normaliseOrder(data);
  },

  cancel: async (id: string): Promise<Order> => {
    const data = await djangoFetch<unknown>(apiUrl(`/orders/${id}/cancel/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify({}),
    });
    return normaliseOrder(data);
  },

  get: async (id: string): Promise<Order> => {
    const data = await djangoFetch<unknown>(apiUrl(`/orders/${id}/`), {
      headers: authHeaders(),
    });
    return normaliseOrder(data);
  },

  addToOrder: async (
    orderId: string,
    items: {
      menu_item_id: string;
      quantity: number;
      selections?: MenuSelection[];
      special_instructions?: string;
    }[],
    notes?: string,
  ): Promise<Order> => {
    const body = {
      items: items.map((i) => ({
        menu_item_id: Number(i.menu_item_id),
        quantity: i.quantity,
        selections: i.selections ?? [],
        special_instructions: i.special_instructions ?? "",
      })),
      notes: notes ?? "",
    };
    const data = await djangoFetch<unknown>(apiUrl(`/orders/${orderId}/add-items/`), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(body),
    });
    return normaliseOrder(data);
  },

  merchantHistory: async (params?: {
    search?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<Order[]> => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set("search", params.search);
    if (params?.status) qs.set("status", params.status);
    if (params?.date_from) qs.set("date_from", params.date_from);
    if (params?.date_to) qs.set("date_to", params.date_to);
    const query = qs.toString();
    const data = await djangoFetch<unknown[]>(
      apiUrl(`/orders/merchant-history/${query ? `?${query}` : ""}`),
      { headers: authHeaders() },
    );
    return data.map(normaliseOrder);
  },
};
