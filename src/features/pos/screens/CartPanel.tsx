import { usePosStore } from "../store";
import { useState, useMemo } from "react";
import { PosReceiptData, PosCustomer, getTaxRate } from "../api";
import CustomerSearchModal from "./CustomerSearchModal";
import TableSelector from "./TableSelector";
import {
  Minus,
  Plus,
  Trash2,
  MessageSquare,
  ShoppingBag,
  Percent,
  FileText,
  User,
  ChevronRight,
  Check,
} from "lucide-react";

interface CartPanelProps {
  onCheckout: () => void;
  onDiscount: () => void;
}

export default function CartPanel({ onCheckout, onDiscount }: CartPanelProps) {
  const cart = usePosStore((s) => s.cart);
  const cartNotes = usePosStore((s) => s.cartNotes);
  const fulfillmentType = usePosStore((s) => s.fulfillmentType);
  const posSettings = usePosStore((s) => s.posSettings);
  const merchant = usePosStore((s) => s.merchant);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const menu = usePosStore((s) => s.menu);
  const tables = usePosStore((s) => s.tables);
  const selectedTableId = usePosStore((s) => s.selectedTableId);
  const updateCartItemQty = usePosStore((s) => s.updateCartItemQty);
  const removeItemFromCart = usePosStore((s) => s.removeItemFromCart);
  const clearCart = usePosStore((s) => s.clearCart);
  const setCartNotes = usePosStore((s) => s.setCartNotes);
  const setFulfillmentType = usePosStore((s) => s.setFulfillmentType);
  const setSelectedTable = usePosStore((s) => s.setSelectedTable);
  const setSelectedCustomer = usePosStore((s) => s.setSelectedCustomer);

  const [showNotes, setShowNotes] = useState(false);
  const [printingBill, setPrintingBill] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [linkedCustomer, setLinkedCustomer] = useState<PosCustomer | null>(null);

  const menuItemById = useMemo(() => {
    const map = new Map<number, any>();
    if (menu) {
      for (const items of Object.values(menu.categories)) {
        for (const it of items) map.set(it.id, it);
      }
    }
    return map;
  }, [menu]);

  const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const taxRate = getTaxRate(posSettings);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;
  const selectedTable = tables.find((t) => t.id === selectedTableId);
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const isEmpty = cart.length === 0;

  function handlePrintBill() {
    if (isEmpty) return;
    setPrintingBill(true);

    // Build a bill receipt from cart data
    const billData: PosReceiptData = {
      type: "bill",
      order_id: 0,
      order_uuid: "",
      order_number: "DRAFT",
      kot_number: null,
      status: "pending",
      source: "pos",
      created_at: new Date().toISOString(),
      client_created_at: null,
      merchant: {
        id: 0,
        name: merchant?.business_name ?? "ZENTRO",
        address: "",
        phone: "",
        logo_url: merchant?.logo_url ?? "",
      },
      table: selectedTable
        ? { name: selectedTable.name, number: selectedTable.table_number }
        : null,
      fulfillment_type: fulfillmentType,
      customer_name: linkedCustomer?.full_name ?? null,
      worker_name: currentWorker?.display_name ?? null,
      items: cart.map((item) => ({
        name: item.name,
        price: String(item.price),
        quantity: item.quantity,
        subtotal: String(item.subtotal),
      })),
      subtotal: String(subtotal),
      discounts: [],
      discount_amount: "0.00",
      tax_amount: String(tax),
      service_charge: "0.00",
      total_amount: String(total),
      payments: [],
      total_paid: "0.00",
      change: "0.00",
      payment_status: "unpaid",
      payment_method: "",
      is_offline_receipt: false,
      sync_status: "synced",
    };

    // Open print window with bill content
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setPrintingBill(false);
      return;
    }

    const receiptHtml = `
      <div style="font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.35; width: 72mm; padding: 4mm; color: #000; background: #fff;">
        <div style="text-align: center; margin-bottom: 8px;">
          <p style="font-size: 16px; font-weight: bold; margin: 0;">${billData.merchant.name}</p>
          <p style="font-size: 10px; color: #666; margin: 2px 0;">** DRAFT BILL **</p>
        </div>
        <hr style="border: none; border-top: 1px dashed #000; margin: 6px 0;">
        <div style="font-size: 11px;">
          <div style="display: flex; justify-content: space-between;"><span>Date</span><span>${new Date().toLocaleString("en-MY")}</span></div>
          <div style="display: flex; justify-content: space-between;"><span>Type</span><span>${billData.fulfillment_type}</span></div>
          ${billData.table ? `<div style="display: flex; justify-content: space-between;"><span>Table</span><span>${billData.table.name || "#" + billData.table.number}</span></div>` : ""}
          ${billData.worker_name ? `<div style="display: flex; justify-content: space-between;"><span>Served by</span><span>${billData.worker_name}</span></div>` : ""}
          ${billData.customer_name ? `<div style="display: flex; justify-content: space-between;"><span>Customer</span><span>${billData.customer_name}</span></div>` : ""}
        </div>
        <hr style="border: none; border-top: 2px solid #000; margin: 8px 0;">
        <div style="font-size: 11px;">
          ${billData.items.map(item => `
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
              <span style="font-weight: bold;">${item.quantity}x ${item.name}</span>
              <span>Rs ${Number(item.subtotal).toFixed(2)}</span>
            </div>
            ${item.quantity > 1 ? `<div style="text-align: right; font-size: 10px; color: #666;">@ Rs ${Number(item.price).toFixed(2)} each</div>` : ""}
          `).join("")}
        </div>
        <hr style="border: none; border-top: 1px dashed #000; margin: 6px 0;">
        <div style="font-size: 11px;">
          <div style="display: flex; justify-content: space-between;"><span>Subtotal</span><span>Rs ${subtotal.toFixed(2)}</span></div>
          ${tax > 0 ? `<div style="display: flex; justify-content: space-between;"><span>VAT (${(taxRate * 100).toFixed(0)}%)</span><span>Rs ${tax.toFixed(2)}</span></div>` : ""}
          <hr style="border: none; border-top: 2px solid #000; margin: 6px 0;">
          <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 14px;">
            <span>TOTAL</span><span>Rs ${total.toFixed(2)}</span>
          </div>
        </div>
        <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;">
        <div style="text-align: center; font-size: 11px; font-weight: bold;">** AWAITING PAYMENT **</div>
      </div>
    `;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html><head><title>Bill - ${billData.merchant.name}</title>
      <style>
        @page { size: 80mm auto; margin: 3mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { width: 72mm; }
        @media print {
          html, body { width: 72mm; }
          .no-print { display: none !important; }
        }
      </style>
      </head><body>
        <div class="no-print" style="padding: 8px; text-align: center; border-bottom: 1px solid #ccc; margin-bottom: 8px;">
          <button onclick="window.print(); window.close();" style="padding: 8px 16px; font-size: 14px; cursor: pointer; background: #1a1a1a; color: white; border: none; border-radius: 8px;">Print Bill</button>
        </div>
        ${receiptHtml}
      </body></html>
    `);
    printWindow.document.close();
    setPrintingBill(false);
  }

  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      {/* ── Header ── */}
      <div className="shrink-0 px-5 pb-4 pt-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-ember" />
            <h2 className="text-base font-bold text-foreground">
              Current Order
            </h2>
            {!isEmpty && (
              <span className="rounded-full bg-mist px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
            )}
          </div>
          {!isEmpty && (
            <button
              onClick={clearCart}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-red-50"
            >
              Clear
            </button>
          )}
        </div>

        {/* Order type segmented control */}
        <div className="mt-4 flex gap-1.5 rounded-2xl bg-mist p-1.5">
          {[
            { key: "dine-in", label: "Dine-In" },
            { key: "takeaway", label: "Takeaway" },
            { key: "delivery", label: "Delivery" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setFulfillmentType(key);
                if (key !== "dine-in") setSelectedTable(null);
              }}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all ${
                fulfillmentType === key
                  ? "bg-ink text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Table selector for dine-in */}
        {fulfillmentType === "dine-in" && tables.length > 0 && (
          <div className="mt-4">
            <TableSelector />
          </div>
        )}

        {/* Customer link */}
        <div className="mt-4">
          {linkedCustomer ? (
            <div className="flex items-center gap-3 rounded-2xl border border-ember/30 bg-ember-soft/50 px-4 py-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ember text-white">
                <User className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {linkedCustomer.full_name}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {linkedCustomer.phone || linkedCustomer.email || "No contact"}
                  {linkedCustomer.membership_number &&
                    ` · ${linkedCustomer.membership_number}`}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  onClick={() => setShowCustomerSearch(true)}
                  className="text-right text-[11px] font-semibold text-ember hover:underline"
                >
                  Change
                </button>
                <button
                  onClick={() => {
                    setLinkedCustomer(null);
                    setSelectedCustomer(null);
                  }}
                  className="text-right text-[11px] font-medium text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCustomerSearch(true)}
              className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-[var(--shadow-card)] transition-all hover:border-ember/50 hover:bg-ember-soft/30"
            >
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mist">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  Customer
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Link a customer to this order
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Customer Search Modal */}
      {showCustomerSearch && (
        <CustomerSearchModal
          onSelect={(customer) => {
            setLinkedCustomer(customer);
            setSelectedCustomer(customer.id || null);
            setShowCustomerSearch(false);
          }}
          onClose={() => setShowCustomerSearch(false)}
        />
      )}

      {/* ── Order items ── */}
      <div className="flex-1 overflow-y-auto border-y border-border">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center py-12 text-muted-foreground">
            <ShoppingBag className="mb-3 h-12 w-12 opacity-25" />
            <p className="text-sm font-medium">Cart is empty</p>
            <p className="mt-1 text-xs">Tap items on the menu to add</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {cart.map((item, idx) => {
              const meta = menuItemById.get(item.menu_item_id);
              return (
                <div key={`${item.menu_item_id}-${idx}`} className="flex items-center gap-3 px-5 py-3.5">
                  {/* Thumbnail */}
                  <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-mist text-xl">
                    {meta?.image_url ? (
                      <img
                        src={meta.image_url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                        crossOrigin="anonymous"
                      />
                    ) : (
                      meta?.emoji || "🍽️"
                    )}
                  </div>

                  {/* Details */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {item.name}
                      </p>
                      <p className="shrink-0 text-sm font-bold text-foreground">
                        Rs {item.subtotal.toFixed(2)}
                      </p>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Rs {item.price.toFixed(2)} each
                    </p>

                    {/* Quantity controls */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex items-center rounded-xl border border-border bg-card">
                        <button
                          onClick={() =>
                            item.quantity > 1
                              ? updateCartItemQty(idx, item.quantity - 1)
                              : removeItemFromCart(idx)
                          }
                          className="grid h-9 w-9 place-items-center rounded-l-xl text-muted-foreground transition-colors hover:bg-mist hover:text-foreground"
                        >
                          {item.quantity === 1 ? (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          ) : (
                            <Minus className="h-4 w-4" />
                          )}
                        </button>
                        <span className="w-9 text-center text-sm font-semibold text-foreground">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateCartItemQty(idx, item.quantity + 1)}
                          className="grid h-9 w-9 place-items-center rounded-r-xl text-muted-foreground transition-colors hover:bg-mist hover:text-foreground"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <button
                        onClick={() => removeItemFromCart(idx)}
                        title="Remove item"
                        className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:border-red-200 hover:bg-red-50 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Notes ── */}
      {!isEmpty && (
        <div className="shrink-0 px-5 py-3">
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {showNotes ? "Hide note" : "Add a note to order"}
          </button>
          {showNotes && (
            <textarea
              value={cartNotes}
              onChange={(e) => setCartNotes(e.target.value)}
              placeholder="No sugar, extra hot..."
              rows={2}
              className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
            />
          )}
        </div>
      )}

      {/* ── Pricing summary ── */}
      <div className="shrink-0 space-y-2 border-t border-border bg-card px-5 py-4">
        <div className="flex items-center justify-between text-[13px] text-muted-foreground">
          <span>Subtotal</span>
          <span className="font-medium text-foreground">
            Rs {subtotal.toFixed(2)}
          </span>
        </div>
        {tax > 0 && (
          <div className="flex items-center justify-between text-[13px] text-muted-foreground">
            <span>VAT ({(taxRate * 100).toFixed(0)}%)</span>
            <span className="font-medium text-foreground">
              Rs {tax.toFixed(2)}
            </span>
          </div>
        )}
        <button
          onClick={onDiscount}
          className="flex w-full items-center justify-between rounded-lg px-1 py-0.5 text-[13px] text-muted-foreground transition-colors hover:text-ember"
        >
          <span className="flex items-center gap-1.5">
            <Percent className="h-3.5 w-3.5" />
            Discount
          </span>
          <span className="font-medium text-ember">Add</span>
        </button>
        <div className="flex items-end justify-between border-t border-border pt-2">
          <span className="text-sm font-semibold text-foreground">Total</span>
          <span className="text-2xl font-bold tracking-tight text-foreground">
            Rs {total.toFixed(2)}
          </span>
        </div>
      </div>

      {/* ── Checkout actions ── */}
      <div className="shrink-0 space-y-2 border-t border-border px-5 py-4">
        {!isEmpty && posSettings?.receipt_printing_enabled && (
          <button
            onClick={handlePrintBill}
            disabled={printingBill}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-muted-foreground transition-colors hover:bg-mist"
          >
            <FileText className="h-4 w-4" />
            {printingBill ? "Printing..." : "Print Bill"}
          </button>
        )}
        {posSettings?.discounts_enabled && (
          <button
            onClick={onDiscount}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-muted-foreground transition-colors hover:bg-mist"
          >
            <Percent className="h-4 w-4" />
            Apply Discount
          </button>
        )}
        <button
          onClick={onCheckout}
          disabled={isEmpty}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ember text-base font-bold text-white shadow-[var(--shadow-ember)] transition-all hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
        >
          <Check className="h-5 w-5" strokeWidth={2.5} />
          {isEmpty ? (
            "Add items to place order"
          ) : (
            <>
              Place Order
              <span className="font-extrabold">— Rs {total.toFixed(2)}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
