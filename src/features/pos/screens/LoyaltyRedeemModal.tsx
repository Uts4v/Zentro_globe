import { useEffect, useState } from "react";
import { Gift, History, Ticket, Wallet, X } from "lucide-react";
import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "../offline/hooks";
import OfferRedeemTab from "./redeem/OfferRedeemTab";
import PunchCardRedeemTab from "./redeem/PunchCardRedeemTab";
import RewardRedeemTab from "./redeem/RewardRedeemTab";
import LoyaltyHistoryTab from "./redeem/LoyaltyHistoryTab";

type Tab = "offer" | "punch_card" | "reward" | "history";

const TABS: { id: Tab; label: string; icon: typeof Ticket }[] = [
  { id: "offer", label: "Offer", icon: Ticket },
  { id: "punch_card", label: "Punch card", icon: Gift },
  { id: "reward", label: "Reward", icon: Wallet },
  { id: "history", label: "History", icon: History },
];

/**
 * Everything a cashier can give away or discount, in one place.
 *
 * Employees work the terminal and are not signed in to the merchant dashboard,
 * so the dashboard's redemption screens are out of reach for them in practice.
 * This is the till's version: offers (already supported end to end), punch card
 * proof codes, points rewards, and a look at recent point activity.
 *
 * None of it works offline on purpose. Every one of these hands something over
 * or commits a code, which needs the server to be the one deciding.
 */
export default function LoyaltyRedeemModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("offer");
  const offline = !useOnlineStatus();

  useEffect(() => {
    if (!open) return;
    setTab("offer");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="loyalty-redeem-title"
        className="mx-0 max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card p-6 shadow-2xl sm:mx-4 sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3
            id="loyalty-redeem-title"
            className="flex items-center gap-2 text-base font-bold text-foreground"
          >
            <Gift className="h-5 w-5 text-ember" /> Redeem
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 flex gap-1 rounded-2xl bg-mist p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-medium transition-colors ${
                tab === id
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {offline && (
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Redemptions need a connection so the server can check the code. You can still take
            orders offline.
          </p>
        )}

        {tab === "offer" && <OfferRedeemTab onDone={onClose} />}
        {tab === "punch_card" && <PunchCardRedeemTab />}
        {tab === "reward" && <RewardRedeemTab />}
        {tab === "history" && <LoyaltyHistoryTab />}
      </div>
    </div>
  );
}
