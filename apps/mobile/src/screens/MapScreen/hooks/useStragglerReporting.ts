import { reportStraggler } from '../../../api/client';
import { useStragglerAlerts } from '../../../state/useStragglerAlerts';
import { type Coordinates } from '../../../types';
import { useRef, useEffect } from 'react';
import type { Group, GroupState, User } from '../../../types';

export interface UseStragglerReportingInput {
  fromCoords: Coordinates | undefined;
  group: Group | null;
  groupId: string | null;
  isLeader: boolean;
  state: GroupState | null;
  user: User | null;
}

export function useStragglerReporting({
  fromCoords,
  group,
  groupId,
  isLeader,
  state,
  user,
}: UseStragglerReportingInput) {

  // --- Straggler alerts (leader-only, 1:N vs leader GPS) ----------------------
  // Followers never run distance logic; they only receive APNs from the leader.
  // Configuration UI was removed; detection still reads group fields from DB.
  const { stragglers } = useStragglerAlerts(state, fromCoords ?? undefined, {
    enabled: !!isLeader,
    leaderUserId: user?.id,
    alertsEnabled: group?.stragglerAlerts ?? true,
    thresholdM: group?.stragglerThresholdM ?? 500,
  });
  // On newly flagged members (hysteresis in the hook), leader fans out APNs
  // via RPC — no local notification (would double-fire for the leader).
  const lastStragglerIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isLeader || !groupId) {
      lastStragglerIdsRef.current = new Set();
      return;
    }
    const ids = new Set(stragglers.map((s) => s.userId));
    const newOnes = stragglers.filter((s) => !lastStragglerIdsRef.current.has(s.userId));
    lastStragglerIdsRef.current = ids;
    for (const s of newOnes) {
      void reportStraggler(groupId, s.userId, s.distanceM).catch(() => {
        // Soft-fail: leader-role mismatch / network blip must not escalate to
        // root render fallback. No blind retry.
        // Canonical error event is owned by instrumented Supabase `traceApi`
        // (api.rpc.report_straggler + leader_role_required classification) —
        // do not logError again or the outbox doubles every soft-fail.
      });
    }
  }, [stragglers, isLeader, groupId]);
  return {
    stragglers,
  };
}
