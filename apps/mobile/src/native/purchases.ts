/**
 * StoreKit / Play Billing entry point via expo-iap.
 *
 * Only returns VerifiedPurchase after a successful store transaction.
 * Incomplete payment, cancel, or missing native IAP must never invent a
 * transaction id — Premium unlock requires server apply_verified_purchase.
 *
 * react-native / expo-iap are required lazily so unit tests (and web) do not
 * need a native runtime to import this module.
 */
import { SMALL_TRIP_PASS } from '../entitlements';

function platformOS(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native') as { Platform?: { OS?: string } };
    return Platform?.OS ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export type PurchaseResultStatus =
  | 'purchased'
  | 'restored'
  | 'cancelled'
  | 'unavailable'
  | 'failed';

/** Outcome from native IAP after local/store verification. */
export interface VerifiedPurchase {
  status: 'purchased' | 'restored';
  /** Store transaction identifier — used for server-side duplicate detection. */
  transactionId: string;
  productId: string;
  /** iOS StoreKit 2 JWS / Android purchase token for server verification. */
  purchaseToken?: string | null;
}

export type PurchaseResult =
  | VerifiedPurchase
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason?: string }
  | { status: 'failed'; reason?: string };

/** App Store / Play product SKU (must match store console + DB allow-list). */
export const IAP_PRODUCT_IDS = {
  smallTripPass: SMALL_TRIP_PASS.productId,
} as const;

const ALLOWED_PRODUCT_IDS = new Set<string>([
  IAP_PRODUCT_IDS.smallTripPass,
  'small_trip_pass',
  'hither.small_trip_pass',
]);

type ExpoIapModule = typeof import('expo-iap');

let iapModule: ExpoIapModule | null | undefined;
let connectionReady = false;

function loadIap(): ExpoIapModule | null {
  if (iapModule !== undefined) return iapModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    iapModule = require('expo-iap') as ExpoIapModule;
  } catch {
    iapModule = null;
  }
  return iapModule;
}

async function ensureConnection(iap: ExpoIapModule): Promise<boolean> {
  if (connectionReady) return true;
  try {
    await iap.initConnection();
    connectionReady = true;
    return true;
  } catch {
    connectionReady = false;
    return false;
  }
}

function mapPurchase(
  purchase: {
    id?: string | null;
    transactionId?: string | null;
    productId?: string | null;
    purchaseToken?: string | null;
  },
  status: 'purchased' | 'restored',
): PurchaseResult {
  const productId = String(purchase.productId ?? '').trim();
  const transactionId = String(
    purchase.transactionId ?? purchase.id ?? '',
  ).trim();
  if (!transactionId || !productId) {
    return { status: 'failed', reason: 'missing_transaction' };
  }
  if (!ALLOWED_PRODUCT_IDS.has(productId) && !ALLOWED_PRODUCT_IDS.has(productId.toLowerCase())) {
    // Still accept store SKUs that map to small trip pass on the server.
    // Server allow-list is authoritative.
  }
  return {
    status,
    transactionId,
    productId,
    purchaseToken: purchase.purchaseToken ?? null,
  };
}

function isUserCancel(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: string }).code ?? '')
      : '';
  const message = err instanceof Error ? err.message : String(err ?? '');
  return (
    /cancel|E_USER_CANCELLED|user-cancelled|UserCancelled/i.test(code)
    || /cancel|cancelled|canceled/i.test(message)
  );
}

/**
 * Present App Store / Play purchase sheet for Small Trip Premium Pass.
 * Does not unlock Premium — caller must applyVerifiedPurchase on the server.
 */
export async function purchasePro(): Promise<PurchaseResult> {
  if (platformOS() === 'web') {
    return { status: 'unavailable', reason: 'web_not_supported' };
  }

  const iap = loadIap();
  if (!iap) {
    return { status: 'unavailable', reason: 'native_iap_not_linked' };
  }

  try {
    const connected = await ensureConnection(iap);
    if (!connected) {
      return { status: 'unavailable', reason: 'store_connection_failed' };
    }

    const sku = IAP_PRODUCT_IDS.smallTripPass;
    const products = await iap.fetchProducts({
      skus: [sku, 'small_trip_pass', 'hither.small_trip_pass'],
      type: 'in-app',
    });
    const list = Array.isArray(products) ? products : [];
    if (list.length === 0) {
      return { status: 'unavailable', reason: 'product_not_found' };
    }

    const resolvedSku = String(
      (list[0] as { id?: string; productId?: string }).id
        ?? (list[0] as { productId?: string }).productId
        ?? sku,
    );

    const purchase = await new Promise<PurchaseResult>((resolve) => {
      let settled = false;
      const finish = (result: PurchaseResult) => {
        if (settled) return;
        settled = true;
        try {
          subUpdate.remove();
        } catch {
          /* ignore */
        }
        try {
          subError.remove();
        } catch {
          /* ignore */
        }
        resolve(result);
      };

      const subUpdate = iap.purchaseUpdatedListener((p) => {
        finish(mapPurchase(p as {
          id?: string | null;
          transactionId?: string | null;
          productId?: string | null;
          purchaseToken?: string | null;
        }, 'purchased'));
      });
      const subError = iap.purchaseErrorListener((err) => {
        if (isUserCancel(err)) {
          finish({ status: 'cancelled' });
          return;
        }
        const reason =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message?: string }).message ?? 'purchase_error')
            : 'purchase_error';
        finish({ status: 'failed', reason });
      });

      void iap
        .requestPurchase({
          type: 'in-app',
          request: {
            apple: { sku: resolvedSku },
            google: { skus: [resolvedSku] },
          },
        })
        .catch((err: unknown) => {
          if (isUserCancel(err)) {
            finish({ status: 'cancelled' });
            return;
          }
          finish({
            status: 'failed',
            reason: err instanceof Error ? err.message : 'request_failed',
          });
        });

      // Safety timeout so UI never hangs if store never replies.
      setTimeout(() => {
        finish({ status: 'failed', reason: 'purchase_timeout' });
      }, 120_000);
    });

    if (purchase.status === 'purchased' || purchase.status === 'restored') {
      // Finish after server apply — caller may finish; best-effort here is OK
      // only after we have a transaction id (server still must grant).
      try {
        const available = await iap.getAvailablePurchases();
        const match = (available ?? []).find((p) => {
          const tid = String(
            (p as { transactionId?: string; id?: string }).transactionId
              ?? (p as { id?: string }).id
              ?? '',
          );
          return tid === purchase.transactionId;
        });
        if (match) {
          // Defer finish to after server grant when possible; still clear queue
          // so iOS does not replay forever if server already recorded txn.
          await iap.finishTransaction({ purchase: match, isConsumable: false });
        }
      } catch {
        /* server grant is authoritative; finish is best-effort */
      }
    }

    return purchase;
  } catch (err) {
    if (isUserCancel(err)) return { status: 'cancelled' };
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : 'purchase_exception',
    };
  }
}

/**
 * Restore completed store purchases. Returns a verified purchase if any
 * matching Small Trip product is found; otherwise unavailable/none.
 * Premium unlock still requires server apply / restore_entitlements.
 */
export async function restorePurchases(): Promise<PurchaseResult> {
  if (platformOS() === 'web') {
    return { status: 'unavailable', reason: 'web_not_supported' };
  }

  const iap = loadIap();
  if (!iap) {
    return { status: 'unavailable', reason: 'native_iap_not_linked' };
  }

  try {
    const connected = await ensureConnection(iap);
    if (!connected) {
      return { status: 'unavailable', reason: 'store_connection_failed' };
    }

    try {
      await iap.restorePurchases();
    } catch {
      /* Android may only need getAvailablePurchases */
    }

    const available = await iap.getAvailablePurchases();
    const list = Array.isArray(available) ? available : [];
    const match = list.find((p) => {
      const pid = String((p as { productId?: string }).productId ?? '').toLowerCase();
      return (
        pid.includes('small_trip')
        || ALLOWED_PRODUCT_IDS.has(pid)
        || ALLOWED_PRODUCT_IDS.has(String((p as { productId?: string }).productId ?? ''))
      );
    });

    if (!match) {
      return { status: 'unavailable', reason: 'no_restorable_purchase' };
    }

    return mapPurchase(match as {
      id?: string | null;
      transactionId?: string | null;
      productId?: string | null;
      purchaseToken?: string | null;
    }, 'restored');
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : 'restore_exception',
    };
  }
}

/** True when the native layer reported a verified purchase/restore outcome. */
export function isVerifiedPurchase(result: PurchaseResult): result is VerifiedPurchase {
  return result.status === 'purchased' || result.status === 'restored';
}
