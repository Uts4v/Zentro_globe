// src/components/home/QuickActions.tsx
// Two minimalist action tiles matching clean design system: Scan QR + Transfer Points
import { motion } from "framer-motion";
import { ScanLine, ArrowLeftRight, ArrowRight } from "lucide-react";

interface QuickActionsProps {
  onScanQR: () => void;
  onTransfer: () => void;
  availablePoints: number;
  merchantColor?: string;
}

export function QuickActions({ onScanQR, onTransfer, availablePoints }: QuickActionsProps) {
  return (
    <section className="px-5">
      <div className="grid grid-cols-2 gap-3">
        {/* Scan to Order (Clean Minimal White Tile) */}
        <motion.button
          onClick={onScanQR}
          className="group relative overflow-hidden bg-card p-4.5 pb-12 text-left transition-all"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          whileTap={{ scale: 0.97 }}
          style={{
            borderRadius: 28,
            boxShadow: "var(--shadow-card)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="relative mb-3.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-ember-soft text-ember transition-transform duration-300 group-active:scale-95">
            <ScanLine className="h-5.5 w-5.5" strokeWidth={2} />
          </div>

          <p className="relative text-[15px] font-extrabold text-foreground">Scan QR</p>
          <p className="relative mt-0.5 text-[11px] font-medium leading-snug text-muted-foreground">
            Scan table QR to order
          </p>

          <span className="absolute bottom-4 right-4 flex h-7 w-7 items-center justify-center rounded-full bg-muted text-foreground transition-all group-hover:translate-x-0.5">
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        </motion.button>

        {/* Transfer Points (Clean Minimal White Tile) */}
        <motion.button
          onClick={onTransfer}
          className="group relative overflow-hidden bg-card p-4.5 pb-12 text-left transition-all"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          whileTap={{ scale: 0.97 }}
          style={{
            borderRadius: 28,
            boxShadow: "var(--shadow-card)",
            border: "1px solid var(--border)",
          }}
        >
          {/* Points Balance Badge */}
          <span className="absolute top-4 right-4 rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-extrabold text-background shadow-xs">
            {availablePoints} pts
          </span>

          <div className="relative mb-3.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-foreground transition-transform duration-300 group-active:scale-95">
            <ArrowLeftRight className="h-5.5 w-5.5" strokeWidth={2} />
          </div>

          <p className="relative text-[15px] font-extrabold text-foreground">Transfer Points</p>
          <p className="relative mt-0.5 text-[11px] font-medium leading-snug text-muted-foreground">
            Send or receive points
          </p>

          <span className="absolute bottom-4 right-4 flex h-7 w-7 items-center justify-center rounded-full bg-muted text-foreground transition-all group-hover:translate-x-0.5">
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        </motion.button>
      </div>
    </section>
  );
}
