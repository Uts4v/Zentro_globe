import { useState, useEffect } from "react";
import { ZentroMascot } from "@/components/brand/ZentroMascot";

interface ZentroLoadingScreenProps {
  duration?: number;
  onComplete?: () => void;
}

export function ZentroLoadingScreen({ duration = 2000, onComplete }: ZentroLoadingScreenProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onComplete?.(), 500);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onComplete]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center transition-opacity duration-500"
      style={{
        background: "linear-gradient(180deg, #FAF8F4 0%, #F0EDE8 100%)",
        opacity: visible ? 1 : 0,
      }}
    >
      <div className="flex flex-col items-center gap-6">
        {/* Mascot with bounce animation */}
        <div className="animate-mascot-bounce">
          <ZentroMascot className="h-32 w-32 drop-shadow-lg" waving celebrate />
        </div>

        {/* Brand name */}
        <div className="flex flex-col items-center gap-1">
          <h1
            className="text-4xl font-black tracking-tight"
            style={{ color: "var(--ink)", fontFamily: "var(--font-display)" }}
          >
            Zentro
          </h1>
          <p
            className="text-xs font-medium uppercase tracking-[0.3em]"
            style={{ color: "var(--muted-foreground)" }}
          >
            Order & Loyalty
          </p>
        </div>

        {/* Loading dots */}
        <div className="mt-4 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="block h-2 w-2 rounded-full"
              style={{
                background: "var(--ember)",
                animation: `pulse-soft 1.2s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
