import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSession } from '../state/SessionContext';
import {
  reconcileUnfinishedPremiumPurchases,
  refreshPremiumProjection,
} from '../services/premiumPurchaseFlow';
import {
  needsBackgroundPremiumRefresh,
  readPremiumProjectionCache,
} from '../services/premiumProjectionCache';

/**
 * Mount once inside SessionProvider. StoreKit replays unfinished transactions
 * on launch; this component retries verification/finish without showing a
 * false success state or creating an offline outbox.
 */
export default function PremiumPurchaseRecovery() {
  const { initializing, user, membership, refreshEntitlement } = useSession();

  useEffect(() => {
    if (initializing || !user) return;
    let cancelled = false;
    let running: Promise<void> | null = null;

    const reconcile = () => {
      if (running) return running;
      running = (async () => {
        const result = await reconcileUnfinishedPremiumPurchases({
          userId: user.id,
          groupId: membership?.group.id ?? null,
        });
        if (cancelled) return;
        if (result.settled > 0) {
          await refreshEntitlement(membership?.group.id ?? null);
          return;
        }
        const cached = await readPremiumProjectionCache(user.id);
        if (needsBackgroundPremiumRefresh(cached)) {
          await refreshPremiumProjection({
            groupId: membership?.group.id ?? null,
            userId: user.id,
            syncStoreKitIfMissing: true,
          });
          if (!cancelled) await refreshEntitlement(membership?.group.id ?? null);
        }
      })()
        .catch(() => undefined)
        .finally(() => {
          running = null;
        });
      return running;
    };

    void reconcile();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void reconcile();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [initializing, user, membership?.group.id, refreshEntitlement]);

  return null;
}
