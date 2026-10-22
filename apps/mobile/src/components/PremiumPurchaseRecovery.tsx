import React, { useState } from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
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

  const groupId = membership?.group.id;
  const [recoveryIdentity, setRecoveryIdentity] = useState({ initializing, user, groupId, refreshEntitlement, generation: 0 });
  if (!Object.is(recoveryIdentity.initializing, initializing) || !Object.is(recoveryIdentity.user, user) || !Object.is(recoveryIdentity.groupId, groupId) || !Object.is(recoveryIdentity.refreshEntitlement, refreshEntitlement)) {
    setRecoveryIdentity({ initializing, user, groupId, refreshEntitlement, generation: recoveryIdentity.generation + 1 });
  }
  return <PremiumRecoverySession key={recoveryIdentity.generation} initializing={initializing} user={user} groupId={groupId} refreshEntitlement={refreshEntitlement} />;
}

function PremiumRecoverySession({ initializing, user, groupId, refreshEntitlement }: {
  initializing: boolean;
  user: ReturnType<typeof useSession>['user'];
  groupId: string | undefined;
  refreshEntitlement: ReturnType<typeof useSession>['refreshEntitlement'];
}) {
  useMountEffect(() => {
    if (initializing || !user) return;
    let cancelled = false;
    let running: Promise<void> | null = null;

    const reconcile = () => {
      if (cancelled) return Promise.resolve();
      if (running) return running;
      running = (async () => {
        const result = await reconcileUnfinishedPremiumPurchases({
          userId: user.id,
          groupId: groupId ?? null,
        });
        if (cancelled) return;
        if (result.settled > 0) {
          await refreshEntitlement(groupId ?? null);
          return;
        }
        const cached = await readPremiumProjectionCache(user.id);
        if (cancelled) return;
        if (needsBackgroundPremiumRefresh(cached)) {
          await refreshPremiumProjection({
            groupId: groupId ?? null,
            userId: user.id,
            syncStoreKitIfMissing: true,
          });
          if (!cancelled) await refreshEntitlement(groupId ?? null);
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
  });

  return null;
}
