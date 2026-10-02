import { useState, useEffect } from "react";
import { usePosStore } from "../store";
import { loadPosBootstrap } from "../offline/loader";
import { formatCurrency } from "@/lib/currency";
import { usePosCartPricing } from "../pricing";
import MenuGrid from "./MenuGrid";
import CartPanel from "./CartPanel";
import PaymentSheet from "./PaymentSheet";
import DiscountModal from "./DiscountModal";
import RedeemOfferModal from "./RedeemOfferModal";
import IncomingOrdersPanel from "./IncomingOrdersPanel";
import WaiterCallPanel from "./WaiterCallPanel";
import { Loader2, AlertTriangle, Armchair, ArrowLeft, ShoppingBag } from "lucide-react";

export default function PosOrderScreen() {
  const bootstrap = usePosStore((s) => s.bootstrap);
  const merchant = usePosStore((s) => s.merchant);
  const [loading, setLoading] = useState(!merchant);
  const [error, setError] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showOffer, setShowOffer] = useState(false);

  useEffect(() => {
    if (merchant) {
      setLoading(false);
      return;
    }

    // Fallback for reaching this screen without the layout's bootstrap having
    // run. Same loader the layout uses, so a till cannot end up with two
    // different notions of what "the server is unreachable" means.
    async function init() {
      setLoading(true);
      setError(null);
      try {
        const loaded = await loadPosBootstrap();
        const opts = loaded.source === "saved" ? { savedAt: loaded.savedAt! } : undefined;
        bootstrap(loaded.data, opts);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to initialize POS");
      } finally {
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
          <p className="mt-3 text-sm text-muted-foreground">Initializing POS...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
          <h2 className="mt-3 text-lg font-bold text-foreground">POS Error</h2>
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
          <WaiterCallPanel />
          <IncomingOrdersPanel />
        </div>
        <div className="min-h-0 flex-1">
          <MenuGrid />
        </div>
      </div>

      {/* Right: current order panel */}
      <div className="hidden w-[380px] shrink-0 xl:block xl:w-[460px]">
        <CartPanel
          onCheckout={() => setShowPayment(true)}
          onDiscount={() => setShowDiscount(true)}
          onRedeemOffer={() => setShowOffer(true)}
        />
      </div>

      {/* Mobile cart drawer toggle */}
      <MobileCartButton
        onCheckout={() => setShowPayment(true)}
        onDiscount={() => setShowDiscount(true)}
        onRedeemOffer={() => setShowOffer(true)}
      />

      <RedeemOfferModal open={showOffer} onClose={() => setShowOffer(false)} />

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
          onApplied={() => {
            // The discount now sits on the cart; the cashier continues from there.
            setShowDiscount(false);
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
  onRedeemOffer,
}: {
  onCheckout: () => void;
  onDiscount: () => void;
  onRedeemOffer: () => void;
}) {
  const cart = usePosStore((s) => s.cart);
  const posSettings = usePosStore((s) => s.posSettings);
  const [open, setOpen] = useState(false);
  const currencySymbol = posSettings?.currency_symbol || "Rs";

  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const grandTotal = usePosCartPricing().totalValue;
  const fulfillmentType = usePosStore((s) => s.fulfillmentType);
  const tables = usePosStore((s) => s.tables);
  const selectedTableId = usePosStore((s) => s.selectedTableId);
  const pickTable = fulfillmentType === "dine-in" && tables.length > 0;
  const tableName = tables.find((t) => t.id === selectedTableId)?.name;

  return (
    <>
      {/* Floating button — on tablets and phones the order panel (order type,
          table, cart) lives in a drawer. It is always reachable, even with an
          empty cart, so a table can be chosen before adding items. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          count > 0 ? "Open current order" : pickTable ? "Choose table" : "Open current order"
        }
        className="fixed bottom-6 right-6 z-40 flex min-h-[48px] items-center gap-3 rounded-full bg-ink px-5 py-3 text-white shadow-2xl xl:hidden"
      >
        {count > 0 ? (
          <>
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-foreground/20 text-xs font-bold">
              {count}
            </span>
            <span className="text-sm font-bold">{formatCurrency(grandTotal, currencySymbol)}</span>
          </>
        ) : (
          !pickTable && (
            <>
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm font-bold">Order</span>
            </>
          )
        )}
        {pickTable && (
          <span className="flex items-center gap-1.5 text-sm font-bold">
            <Armchair className="h-4 w-4" aria-hidden="true" />
            {tableName ?? "Choose table"}
          </span>
        )}
      </button>

      {/* Mobile cart drawer */}
      {open && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 top-0 flex">
            <div className="flex-1" onClick={() => setOpen(false)} />
            <div className="flex h-full min-h-0 w-[26rem] max-w-full flex-col bg-background">
              {/* On a phone the drawer fills the screen, so it needs its own way back. */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex min-h-[48px] shrink-0 items-center gap-2 border-b border-l border-border px-4 text-sm font-semibold text-foreground hover:bg-mist"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to menu
              </button>
              <div className="min-h-0 flex-1">
                <CartPanel
                  onCheckout={() => {
                    setOpen(false);
                    onCheckout();
                  }}
                  onDiscount={() => {
                    setOpen(false);
                    onDiscount();
                  }}
                  onRedeemOffer={() => {
                    setOpen(false);
                    onRedeemOffer();
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
