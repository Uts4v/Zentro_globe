import { useState, useEffect } from "react";
import { usePosStore } from "../store";
import { posBootstrap, getTaxRate } from "../api";
import MenuGrid from "./MenuGrid";
import CartPanel from "./CartPanel";
import PaymentSheet from "./PaymentSheet";
import DiscountModal from "./DiscountModal";
import IncomingOrdersPanel from "./IncomingOrdersPanel";
import { Loader2, AlertTriangle } from "lucide-react";

export default function PosOrderScreen() {
  const bootstrap = usePosStore((s) => s.bootstrap);
  const merchant = usePosStore((s) => s.merchant);
  const [loading, setLoading] = useState(!merchant);
  const [error, setError] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (merchant) {
      setLoading(false);
      return;
    }

    // Bootstrap POS on first load (fallback if PosLayout didn't run)
    async function init() {
      try {
        setLoading(true);
        const deviceId = localStorage.getItem("pos_device_id");
        if (!deviceId) {
          setError("No device registered. Please log in via the POS login screen.");
          setLoading(false);
          return;
        }

        const resp = await posBootstrap(deviceId);
        bootstrap(resp);
        setLoading(false);
      } catch (err: any) {
        setError(err?.message || "Failed to initialize POS");
        setLoading(false);
      }
    }

    init();
  }, [merchant, bootstrap]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-ink" />
          <p className="mt-3 text-sm text-muted-foreground">
            Initializing POS...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
          <h2 className="mt-3 text-lg font-bold text-foreground">
            POS Error
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-ink px-6 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Center: menu workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 px-5 pt-4">
          <IncomingOrdersPanel />
        </div>
        <div className="min-h-0 flex-1">
          <MenuGrid />
        </div>
      </div>

      {/* Right: current order panel */}
      <div className="hidden w-[480px] shrink-0 lg:block xl:w-[500px]">
        <CartPanel
          onCheckout={() => setShowPayment(true)}
          onDiscount={() => setShowDiscount(true)}
        />
      </div>

      {/* Mobile cart drawer toggle */}
      <MobileCartButton
        onCheckout={() => setShowPayment(true)}
        onDiscount={() => setShowDiscount(true)}
      />

      {/* Payment sheet */}
      <PaymentSheet
        open={showPayment}
        onClose={() => setShowPayment(false)}
        onPaid={() => {
          // Refresh orders
        }}
      />

      {/* Discount modal */}
      {showDiscount && (
        <DiscountModal
          open={showDiscount}
          orderId={lastOrderId ?? ""}
          onApplied={() => {
            // Discount applied — continue to payment
            setShowDiscount(false);
            setShowPayment(true);
          }}
          onClose={() => setShowDiscount(false)}
        />
      )}
    </div>
  );
}

// ── Mobile cart floating button ──────────────────────────────────────────────
function MobileCartButton({
  onCheckout,
  onDiscount,
}: {
  onCheckout: () => void;
  onDiscount: () => void;
}) {
  const cart = usePosStore((s) => s.cart);
  const posSettings = usePosStore((s) => s.posSettings);
  const [open, setOpen] = useState(false);

  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const taxRate = getTaxRate(posSettings);
  const tax = total * taxRate;
  const grandTotal = total + tax;

  if (count === 0) return null;

  return (
    <>
      {/* Floating button — visible on mobile only */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-full bg-ink px-5 py-3 text-white shadow-2xl lg:hidden"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-white/20 text-xs font-bold">
          {count}
        </span>
        <span className="text-sm font-bold">Rs {grandTotal.toFixed(2)}</span>
      </button>

      {/* Mobile cart drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 top-0 flex">
            <div className="flex-1" onClick={() => setOpen(false)} />
            <div className="w-80 max-w-full">
              <CartPanel
                onCheckout={() => {
                  setOpen(false);
                  onCheckout();
                }}
                onDiscount={() => {
                  setOpen(false);
                  onDiscount();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
