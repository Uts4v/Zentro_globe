/**
 * Tenders that can be recorded without a server round-trip.
 *
 * Card is excluded because it needs a real terminal/authorisation. Debit is
 * excluded because a prepaid balance cannot be validated offline, so allowing
 * it risks overdrawing the wallet. QR and mobile wallet are excluded from
 * neither: the backend treats them as *recording* methods (no terminal, no
 * provider callback — see backend/pos/views.py create_payment), so staff
 * confirming the customer scanned is sufficient evidence.
 */
const OFFLINE_CAPABLE_METHODS = ["cash", "bank_qr", "mobile_wallet"];

export function isOfflineCapableMethod(key: string): boolean {
  return OFFLINE_CAPABLE_METHODS.includes(key);
}
