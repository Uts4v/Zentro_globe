export interface MerchantThemePreset {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  accent: string;
  gradient: string;
  illustration: "leaf" | "steam" | "olive" | "wheat" | "wave" | "gem";
  businessType: string;
}

export const MERCHANT_THEME_PRESETS: MerchantThemePreset[] = [
  {
    id: "zentro-cafe",
    label: "Zentro Café",
    primary: "#0F3D3A",
    secondary: "#14504B",
    accent: "#F3D98B",
    gradient: "linear-gradient(145deg, #0F3D3A 0%, #14504B 55%, #761C26 100%)",
    illustration: "steam",
    businessType: "cafe",
  },
  {
    id: "tea",
    label: "Tea Shop",
    primary: "#1B5E3B",
    secondary: "#2D8B56",
    accent: "#A8D8B9",
    gradient: "linear-gradient(145deg, #1B5E3B 0%, #2D8B56 60%, #3AA06A 100%)",
    illustration: "leaf",
    businessType: "tea",
  },
  {
    id: "coffee",
    label: "Coffee Shop",
    primary: "#3E2723",
    secondary: "#5D4037",
    accent: "#D7CCC8",
    gradient: "linear-gradient(145deg, #3E2723 0%, #5D4037 60%, #795548 100%)",
    illustration: "steam",
    businessType: "coffee",
  },
  {
    id: "pizza",
    label: "Pizza",
    primary: "#B71C1C",
    secondary: "#D84315",
    accent: "#FFAB91",
    gradient: "linear-gradient(145deg, #B71C1C 0%, #D84315 60%, #E64A19 100%)",
    illustration: "olive",
    businessType: "pizza",
  },
  {
    id: "bakery",
    label: "Bakery",
    primary: "#F5E6D0",
    secondary: "#D4A574",
    accent: "#8D6E4C",
    gradient: "linear-gradient(145deg, #F5E6D0 0%, #D4A574 60%, #C49A6C 100%)",
    illustration: "wheat",
    businessType: "bakery",
  },
  {
    id: "sushi",
    label: "Sushi",
    primary: "#1A237E",
    secondary: "#283593",
    accent: "#9FA8DA",
    gradient: "linear-gradient(145deg, #1A237E 0%, #283593 60%, #303F9F 100%)",
    illustration: "wave",
    businessType: "sushi",
  },
  {
    id: "luxury",
    label: "Luxury",
    primary: "#1A1A1A",
    secondary: "#2C2C2C",
    accent: "#D4AF37",
    gradient: "linear-gradient(145deg, #1A1A1A 0%, #2C2C2C 50%, #3D3D3D 100%)",
    illustration: "gem",
    businessType: "luxury",
  },
];

export function resolveMerchantPreset(businessType: string | null | undefined): MerchantThemePreset | null {
  if (!businessType) return null;
  const lower = businessType.toLowerCase();
  return MERCHANT_THEME_PRESETS.find((p) => lower.includes(p.businessType)) ?? null;
}

export function getIllustrationSVG(type: MerchantThemePreset["illustration"]): string {
  switch (type) {
    case "leaf":
      return `<svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M60 170C60 170 50 100 90 60C130 20 180 30 180 30C180 30 170 100 130 140C90 180 60 170 60 170Z" fill="currentColor" opacity="0.08"/><path d="M90 60C90 60 120 90 130 140" stroke="currentColor" stroke-width="1.5" opacity="0.06"/></svg>`;
    case "steam":
      return `<svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M100 180C100 180 80 140 100 120C120 100 80 80 100 60C120 40 100 20 100 20" stroke="currentColor" stroke-width="2" opacity="0.07" stroke-linecap="round"/><path d="M130 180C130 180 110 150 130 130C150 110 110 90 130 70C150 50 130 30 130 30" stroke="currentColor" stroke-width="2" opacity="0.05" stroke-linecap="round"/></svg>`;
    case "olive":
      return `<svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M40 160C40 160 80 120 120 100C160 80 180 40 180 40" stroke="currentColor" stroke-width="1.5" opacity="0.07"/><ellipse cx="120" cy="95" rx="18" ry="12" fill="currentColor" opacity="0.06" transform="rotate(-15 120 95)"/><ellipse cx="90" cy="115" rx="16" ry="10" fill="currentColor" opacity="0.05" transform="rotate(-15 90 115)"/></svg>`;
    case "wheat":
      return `<svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M100 180L100 40" stroke="currentColor" stroke-width="1.5" opacity="0.07"/><path d="M100 40C100 40 80 60 100 80C120 60 100 40 100 40Z" fill="currentColor" opacity="0.05"/><path d="M100 80C100 80 80 100 100 120C120 100 100 80 100 80Z" fill="currentColor" opacity="0.04"/><path d="M100 120C100 120 80 140 100 160C120 140 100 120 100 120Z" fill="currentColor" opacity="0.03"/></svg>`;
    case "wave":
      return `<svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 100C40 80 60 120 80 100C100 80 120 120 140 100C160 80 180 120 180 100" stroke="currentColor" stroke-width="2" opacity="0.06" stroke-linecap="round"/><path d="M20 120C40 100 60 140 80 120C100 100 120 140 140 120C160 100 180 140 180 120" stroke="currentColor" stroke-width="1.5" opacity="0.04" stroke-linecap="round"/></svg>`;
    case "gem":
      return `<svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M100 30L140 80L100 170L60 80Z" fill="currentColor" opacity="0.04"/><path d="M60 80H140" stroke="currentColor" stroke-width="1" opacity="0.06"/><path d="M100 30L80 80L100 170" stroke="currentColor" stroke-width="0.8" opacity="0.04"/><path d="M100 30L120 80L100 170" stroke="currentColor" stroke-width="0.8" opacity="0.04"/></svg>`;
  }
}
