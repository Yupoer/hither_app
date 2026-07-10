/**
 * StoreKit in-app purchase entry point. No native module is wired yet —
 * Expo Go (and dev builds without the IAP module) fall back to 'unavailable',
 * and the paywall explains that purchases need the production build.
 * Follow-up: integrate react-native-iap in the dev-build profile.
 */
export type PurchaseResult = 'purchased' | 'cancelled' | 'unavailable';

export async function purchasePro(): Promise<PurchaseResult> {
  return 'unavailable';
}

export async function restorePurchases(): Promise<PurchaseResult> {
  return 'unavailable';
}
