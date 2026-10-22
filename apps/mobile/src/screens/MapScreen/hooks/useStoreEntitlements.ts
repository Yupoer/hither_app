import { getStoreSnapshot } from '../../../api/services/StoreService';
import { type TranslationKey } from '../../../i18n';
import { lightTap } from '../../../utils/haptics';
import React, { useRef, useCallback, useEffect } from 'react';
import type { TripEntitlement } from '../../../entitlements';

export interface UseStoreEntitlementsInput {
  groupId: string | null;
  isAnonymous: boolean;
  isPro: boolean;
  openPaywall: (trigger?: TranslationKey, opts?: { showRestore?: boolean; }) => void;
  refreshEntitlement: (groupId?: string | null) => Promise<TripEntitlement | null>;
  setExtraPointCredits: React.Dispatch<React.SetStateAction<number>>;
  setLiveActivityEffective: React.Dispatch<React.SetStateAction<boolean>>;
  syncFromDatabase: () => Promise<void>;
}

export function useStoreEntitlements({
  groupId,
  isAnonymous,
  isPro,
  openPaywall,
  refreshEntitlement,
  setExtraPointCredits,
  setLiveActivityEffective,
  syncFromDatabase,
}: UseStoreEntitlementsInput) {

  // Entitlement snapshot is bound to the groupId it was fetched for. A slow
  // response for team A must never apply after the user switched to team B.
  const storeEntitlementGenRef = useRef(0);
  const storeEntitlementGroupRef = useRef<string | null>(null);
  /** Last group that successfully applied a store snapshot (for fail-closed scope). */
  const storeEntitlementAppliedGroupRef = useRef<string | null>(null);
  storeEntitlementGroupRef.current = groupId ?? null;

  const refreshStoreEntitlements = useCallback(async () => {
    const requestGroupId = groupId ?? null;
    const gen = ++storeEntitlementGenRef.current;
    if (!requestGroupId || isAnonymous) {
      if (gen === storeEntitlementGenRef.current
        && storeEntitlementGroupRef.current === requestGroupId) {
        setLiveActivityEffective(false);
        setExtraPointCredits(0);
        storeEntitlementAppliedGroupRef.current = null;
      }
      return;
    }
    // Fail-closed only when switching teams so a same-group refresh (e.g. isPro
    // flip) does not flash Tools back to the locked Live Activity row.
    if (storeEntitlementAppliedGroupRef.current !== requestGroupId) {
      setLiveActivityEffective(false);
      setExtraPointCredits(0);
    }
    try {
      const snap = await getStoreSnapshot(requestGroupId);
      if (gen !== storeEntitlementGenRef.current) return;
      if (storeEntitlementGroupRef.current !== requestGroupId) return;
      // Server bit is authoritative; Premium session is a client safety net when
      // snapshot lags after IAP/promo (tools must not stay locked while isPro).
      setLiveActivityEffective(!!snap.liveActivityEffective || isPro);
      setExtraPointCredits(Math.max(0, snap.extraPointCredits ?? 0));
      storeEntitlementAppliedGroupRef.current = requestGroupId;
    } catch {
      if (gen !== storeEntitlementGenRef.current) return;
      if (storeEntitlementGroupRef.current !== requestGroupId) return;
      // Keep Premium-granted LA unlocked offline when session already knows isPro.
      setLiveActivityEffective(isPro);
      if (!isPro) setExtraPointCredits(0);
    }
  }, [groupId, isAnonymous, isPro]);

  useEffect(() => {
    void refreshStoreEntitlements();
  }, [groupId, refreshStoreEntitlements, isPro]);

  const handleEntitlementActivated = useCallback(async () => {
    await refreshEntitlement(groupId);
    await refreshStoreEntitlements();
    await syncFromDatabase();
  }, [groupId, refreshEntitlement, refreshStoreEntitlements, syncFromDatabase]);

  const openPaywallForLiveActivity = useCallback(() => {
    lightTap();
    openPaywall();
  }, [openPaywall]);
  return {
    handleEntitlementActivated,
    openPaywallForLiveActivity,
    refreshStoreEntitlements,
  };
}
