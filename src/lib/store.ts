import { create } from "zustand";
import { persist } from "zustand/middleware";
import { orderApi } from "@/lib/api/orders";
import { cartKey } from "@/lib/menu-utils";
import type { MenuSelection } from "@/lib/api/types";

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  emoji: string;
  points_per_item: number;
  is_available?: boolean;
  is_featured?: boolean;
  image_url?: string | null;
};

/** One cart line. `key` uniquely identifies an item + option selection + notes. */
export type CartItem = {
  key: string;
  itemId: string;
  qty: number;
  selections: MenuSelection[];
  specialInstructions: string;
  unitPrice: number;
};

export type CartLineInput = {
  itemId: string;
  qty?: number;
  selections?: MenuSelection[];
  specialInstructions?: string;
  unitPrice?: number;
};

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

export type FulfillmentType = "dine_in" | "pickup" | "delivery";

export type TableOrderContext = {
  merchantSlug: string;
  tableToken: string;
  tableId: number;
  tableName: string;
  scannedAt: number;
};

export type GuestSession = {
  guestId: string;
  guestName: string;
  joinedAt: number;
};

export type Order = {
  id: string;
  items: CartItem[];
  total: number;
  status: OrderStatus;
  createdAt: string;
  customerName: string;
  pointsEarned: number;
  merchantId?: string;
  merchantName?: string;
  notes?: string;
};

type State = {
  cart: CartItem[];
  orders: Order[];
  points: number;
  streak: number;
  customerName: string;
  selectedMerchantId: string | null;
  activeTable: TableOrderContext | null;
  fulfillmentType: FulfillmentType;
  guestSession: GuestSession | null;
  setSelectedMerchant: (id: string | null) => void;
  setActiveTable: (ctx: TableOrderContext | null) => void;
  setFulfillmentType: (ft: FulfillmentType) => void;
  setGuestSession: (session: GuestSession | null) => void;
  setGuestName: (name: string) => void;
  add: (id: string) => void;
  remove: (id: string) => void;
  addLine: (line: CartLineInput) => void;
  setQty: (key: string, qty: number) => void;
  removeLine: (key: string) => void;
  replaceLine: (oldKey: string, line: CartLineInput) => void;
  clearCart: () => void;
  clearTable: () => void;
  placeOrder: (notes?: string) => Promise<string>;
  placeGuestOrder: (notes?: string, guestName?: string) => Promise<string>;
  updateOrderStatus: (id: string, s: OrderStatus) => void;
  setOrders: (orders: Order[]) => void;
  setPoints: (pts: number) => void;
  setStreak: (s: number) => void;
  setCustomerName: (name: string) => void;
  resetSession: () => void;
};

function materialise(line: CartLineInput, id: string): CartItem {
  const selections = line.selections ?? [];
  const specialInstructions = line.specialInstructions ?? "";
  return {
    key: cartKey(id, selections, specialInstructions),
    itemId: id,
    qty: line.qty ?? 1,
    selections,
    specialInstructions,
    unitPrice: line.unitPrice ?? 0,
  };
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      cart: [],
      orders: [],
      points: 0,
      streak: 0,
      customerName: "",
      selectedMerchantId: null,
      activeTable: null,
      fulfillmentType: "pickup" as FulfillmentType,
      guestSession: null,

      setSelectedMerchant: (id) => set({ selectedMerchantId: id }),

      setActiveTable: (ctx) =>
        set({
          activeTable: ctx,
          fulfillmentType: ctx ? "dine_in" : get().fulfillmentType,
        }),

      setFulfillmentType: (ft) => set({ fulfillmentType: ft }),

      setGuestSession: (session) => set({ guestSession: session }),
      setGuestName: (name) =>
        set((s) => ({
          guestSession: s.guestSession ? { ...s.guestSession, guestName: name } : null,
        })),

      /** Legacy quick-add (no options). Same item/selection → increments qty. */
      add: (id) => {
        const line = materialise({ itemId: id }, id);
        set((s) => {
          const ex = s.cart.find((c) => c.key === line.key);
          return ex
            ? { cart: s.cart.map((c) => (c.key === line.key ? { ...c, qty: c.qty + 1 } : c)) }
            : { cart: [...s.cart, line] };
        });
      },

      /** Legacy decrement-by-item (no options). Removes the line when it hits 0. */
      remove: (id) =>
        set((s) => {
          const matches = s.cart.filter((c) => String(c.itemId) === String(id)).map((c) => c.key);
          if (matches.length === 0) return s;
          const first = matches[0];
          return {
            cart: s.cart
              .map((c) => (c.key === first ? { ...c, qty: c.qty - 1 } : c))
              .filter((c) => c.qty > 0),
          };
        }),

      addLine: (line) =>
        set((s) => {
          const key = cartKey(line.itemId, line.selections ?? [], line.specialInstructions ?? "");
          const ex = s.cart.find((c) => c.key === key);
          if (ex) {
            return {
              cart: s.cart.map((c) => (c.key === key ? { ...c, qty: c.qty + (line.qty ?? 1) } : c)),
            };
          }
          return { cart: [...s.cart, materialise(line, line.itemId)] };
        }),

      setQty: (key, qty) =>
        set((s) => {
          if (qty <= 0) return { cart: s.cart.filter((c) => c.key !== key) };
          return { cart: s.cart.map((c) => (c.key === key ? { ...c, qty } : c)) };
        }),

      removeLine: (key) => set((s) => ({ cart: s.cart.filter((c) => c.key !== key) })),

      replaceLine: (oldKey, line) =>
        set((s) => {
          const rest = s.cart.filter((c) => c.key !== oldKey);
          const key = cartKey(line.itemId, line.selections ?? [], line.specialInstructions ?? "");
          const ex = rest.find((c) => c.key === key);
          if (ex) {
            return {
              cart: rest.map((c) => (c.key === key ? { ...c, qty: c.qty + (line.qty ?? 1) } : c)),
            };
          }
          return { cart: [...rest, materialise(line, line.itemId)] };
        }),

      clearCart: () => set({ cart: [] }),

      clearTable: () => set({ activeTable: null, fulfillmentType: "pickup" }),

      placeOrder: async (notes = "") => {
        const { cart, selectedMerchantId, activeTable, fulfillmentType } = get();
        if (!selectedMerchantId) throw new Error("No merchant selected");
        if (cart.length === 0) throw new Error("Cart is empty");

        const items = cart.map((c) => ({
          menu_item_id: c.itemId,
          quantity: c.qty,
          selections: c.selections,
          special_instructions: c.specialInstructions,
          name: "",
          price: c.unitPrice,
          points_per_item: 0,
        }));

        const apiOrder = await orderApi.create({
          merchant_id: selectedMerchantId,
          items,
          notes,
          fulfillment_type: fulfillmentType,
          table_token: activeTable?.tableToken ?? "",
        });

        const order: Order = {
          id: apiOrder.id,
          items: cart,
          total: parseFloat(apiOrder.total_amount),
          status: apiOrder.status as OrderStatus,
          createdAt: apiOrder.created_at,
          customerName: apiOrder.profiles?.full_name ?? "",
          pointsEarned: apiOrder.points_earned,
          merchantId: apiOrder.merchant_id,
          merchantName: apiOrder.merchant_profiles?.business_name,
          notes: apiOrder.notes,
        };

        set((s) => ({
          orders: [order, ...s.orders],
          cart: [],
        }));

        return order.id;
      },

      placeGuestOrder: async (notes = "", guestName = "") => {
        const { cart, selectedMerchantId, activeTable, guestSession } = get();
        if (!selectedMerchantId) throw new Error("No merchant selected");
        if (cart.length === 0) throw new Error("Cart is empty");
        if (!activeTable) throw new Error("No table selected");

        const items = cart.map((c) => ({
          menu_item_id: c.itemId,
          quantity: c.qty,
          selections: c.selections,
          special_instructions: c.specialInstructions,
          name: "",
          price: c.unitPrice,
          points_per_item: 0,
        }));

        const apiOrder = await orderApi.createGuest({
          merchant_id: selectedMerchantId,
          items,
          notes,
          table_token: activeTable.tableToken,
          guest_session_id: guestSession?.guestId ?? "",
          guest_name: guestName || guestSession?.guestName || "",
        });

        const order: Order = {
          id: apiOrder.id,
          items: cart,
          total: parseFloat(apiOrder.total_amount),
          status: apiOrder.status as OrderStatus,
          createdAt: apiOrder.created_at,
          customerName: guestName || guestSession?.guestName || "Guest",
          pointsEarned: 0,
          merchantId: apiOrder.merchant_id,
          merchantName: apiOrder.merchant_profiles?.business_name,
          notes: apiOrder.notes,
        };

        set((s) => ({
          orders: [order, ...s.orders],
          cart: [],
        }));

        return order.id;
      },

      updateOrderStatus: (id, status) =>
        set((s) => ({
          orders: s.orders.map((o) => (o.id === id ? { ...o, status } : o)),
        })),

      setOrders: (orders) => set({ orders }),
      setPoints: (pts) => set({ points: pts }),
      setStreak: (s) => set({ streak: s }),
      setCustomerName: (name) => set({ customerName: name }),
      resetSession: () =>
        set({
          cart: [],
          orders: [],
          points: 0,
          streak: 0,
          customerName: "",
          selectedMerchantId: null,
          activeTable: null,
          guestSession: null,
        }),
    }),
    {
      name: "zentro-store",
      partialize: (state) => ({
        cart: state.cart,
        selectedMerchantId: state.selectedMerchantId,
        activeTable: state.activeTable,
        fulfillmentType: state.fulfillmentType,
        points: state.points,
        streak: state.streak,
        customerName: state.customerName,
        guestSession: state.guestSession,
      }),
    },
  ),
);

/** Sum of the cart using stored unit prices (option-aware). */
export const cartTotals = (cart: CartItem[]) =>
  cart.reduce((sum, c) => sum + (c.unitPrice || 0) * c.qty, 0);

export const cartCount = (cart: CartItem[]) => cart.reduce((sum, c) => sum + c.qty, 0);

/** Legacy total — falls back to menu prices for items without a stored unit price. */
export const cartTotal = (cart: CartItem[], menuItems?: MenuItem[]) =>
  cart.reduce((sum, c) => {
    const i = menuItems?.find((m) => String(m.id) === String(c.itemId));
    if (c.unitPrice) return sum + c.unitPrice * c.qty;
    return i ? sum + i.price * c.qty : sum;
  }, 0);

export const cartPoints = (cart: CartItem[], menuItems?: MenuItem[]) =>
  cart.reduce((sum, c) => {
    const i = menuItems?.find((m) => String(m.id) === String(c.itemId));
    return i ? sum + (i.points_per_item || 0) * c.qty : sum;
  }, 0);
