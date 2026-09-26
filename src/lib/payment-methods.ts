/**
 * Display names for stored POS payment methods. Every method is recorded
 * manually by the cashier; the stored key is what reports group by.
 */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  bank_qr: "QR Payment",
  mobile_wallet: "Digital Payment",
  debit: "Debit",
  credit: "Credit",
  split: "Split",
  other: "Other",
};

export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "-";
  return (
    PAYMENT_METHOD_LABELS[method] ??
    method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
