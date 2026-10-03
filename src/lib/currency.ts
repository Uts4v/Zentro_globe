/**
 * Currency formatting utilities.
 *
 * Usage:
 *   import { formatCurrency } from "@/lib/currency";
 *   formatCurrency(1250, "Rs")  // "Rs 1,250.00"
 *   formatCurrency(1250, "₹")  // "₹ 1,250.00"
 */

export const CURRENCIES = [
  { code: "NPR", symbol: "Rs", label: "Nepalese Rupee (Rs)" },
  { code: "INR", symbol: "₹", label: "Indian Rupee (₹)" },
  { code: "USD", symbol: "$", label: "US Dollar ($)" },
  { code: "EUR", symbol: "€", label: "Euro (€)" },
  { code: "GBP", symbol: "£", label: "British Pound (£)" },
  { code: "THB", symbol: "฿", label: "Thai Baht (฿)" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar (A$)" },
  { code: "CAD", symbol: "C$", label: "Canadian Dollar (C$)" },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar (S$)" },
  { code: "AED", symbol: "د.إ", label: "UAE Dirham (د.إ)" },
  { code: "SAR", symbol: "﷼", label: "Saudi Riyal (﷼)" },
  { code: "MYR", symbol: "RM", label: "Malaysian Ringgit (RM)" },
  { code: "PHP", symbol: "₱", label: "Philippine Peso (₱)" },
  { code: "IDR", symbol: "Rp", label: "Indonesian Rupiah (Rp)" },
  { code: "BDT", symbol: "৳", label: "Bangladeshi Taka (৳)" },
  { code: "LKR", symbol: "Rs", label: "Sri Lankan Rupee (Rs)" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

/**
 * Format a number as currency with the given symbol.
 *
 * @param amount  – numeric value
 * @param symbol  – currency symbol (e.g. "Rs", "₹", "$")
 * @param decimals – decimal places (default 2)
 */
export function formatCurrency(amount: number | string, symbol = "Rs", decimals = 2): string {
  const num = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(num)) return `${symbol} 0.00`;
  return `${symbol} ${num.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Get currency symbol from a code (e.g. "INR" → "₹").
 * Falls back to the code itself if unknown.
 */
export function getCurrencySymbol(code: string): string {
  const found = CURRENCIES.find((c) => c.code.toUpperCase() === code.toUpperCase());
  return found?.symbol ?? code;
}

/**
 * Round a money value to cents. Float math like `120 - 113.11` yields
 * 6.890000000000001, which the API's 2-decimal fields reject.
 */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
