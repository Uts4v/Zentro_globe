import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface MerchantThemeContextValue {
  themeColor: string;
  setThemeColor: (color: string) => void;
}

const MerchantThemeContext = createContext<MerchantThemeContextValue>({
  themeColor: "",
  setThemeColor: () => {},
});

export function useMerchantTheme() {
  return useContext(MerchantThemeContext);
}

export function hexToHSL(hex: string): { h: number; s: number; l: number } | null {
  if (!hex || !hex.startsWith("#")) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export { withAlpha };

export function MerchantThemeProvider({ children }: { children: ReactNode }) {
  const [themeColor, setThemeColorState] = useState("");

  const setThemeColor = useCallback((color: string) => {
    setThemeColorState(color);
  }, []);

  return (
    <MerchantThemeContext.Provider value={{ themeColor, setThemeColor }}>
      {children}
    </MerchantThemeContext.Provider>
  );
}
