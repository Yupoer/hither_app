/**
 * StoreKit / Play Billing entry point (BUILD-02).
 *
 * OTA-08 consumes *verified* purchase outcomes only. Until BUILD-02 wires the
 * native module, both calls return 'unavailable' and never invent a transaction
 * id — incomplete payment or failed verification must not unlock Premium.
 *
 * When BUILD-02 lands, successful paths should return a VerifiedPurchase with a
 * stable transactionId that EntitlementService.applyVerifiedPurchase can map
 * to a server Small Trip Pass.
 */

export type PurchaseResultStatus =
  | 'purchased'
  | 'restored'
  | 'cancelled'
  | 'unavailable'
  | 'failed';

/** Outcome from native IAP after local/store verification (BUILD-02). */
export interface VerifiedPurchase {
  status: 'purchased' | 'restored';
  /** Store transaction identifier — used for server-side duplicate detection. */
  transactionId: string;
  productId: string;
}

export type PurchaseResult =
  | VerifiedPurchase
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason?: string }
  | { status: 'failed'; reason?: string };

export async function purchasePro(): Promise<PurchaseResult> {
  // BUILD-02: invoke StoreKit / Play Billing, verify, then return VerifiedPurchase.
  return { status: 'unavailable', reason: 'native_iap_not_linked' };
}

export async function restorePurchases(): Promise<PurchaseResult> {
  // BUILD-02: restore from store, verify, then return VerifiedPurchase if any.
  // OTA-08 always re-fetches server entitlement after this call regardless.
  return { status: 'unavailable', reason: 'native_iap_not_linked' };
}

/** True when the native layer reported a verified purchase/restore outcome. */
export function isVerifiedPurchase(result: PurchaseResult): result is VerifiedPurchase {
  return result.status === 'purchased' || result.status === 'restored';
}
