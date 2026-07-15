import { useMemo, useRef } from 'react';
import { findStragglers, type Straggler } from '../utils/straggler';
import type { Coordinates, GroupState } from '../types';

interface UseStragglerAlertsResult {
  /** Members currently over the threshold. */
  stragglers: Straggler[];
}

/**
 * Leader-side straggler state. Wraps `findStragglers` with hysteresis:
 * a member who trips the threshold stays flagged until they close back inside
 * 80% of it. Data-only — callers fire APN via RPC. Pass `enabled: false` for
 * non-leaders so followers never run distance logic.
 */
export function useStragglerAlerts(
  groupState: GroupState | null,
  leaderCoordinates: Coordinates | undefined,
  options?: { enabled?: boolean; leaderUserId?: string },
): UseStragglerAlertsResult {
  const enabled = options?.enabled ?? true;
  const leaderUserId = options?.leaderUserId;
  const alertingRef = useRef<Set<string>>(new Set());

  const stragglers = useMemo(() => {
    if (!enabled || !groupState || !groupState.group.stragglerAlerts || !leaderCoordinates) {
      alertingRef.current = new Set();
      return [];
    }
    const thresholdM = groupState.group.stragglerThresholdM;
    const overThreshold = findStragglers({
      members: groupState.members,
      target: leaderCoordinates,
      thresholdM,
      leaderUserId,
    });
    const overRelease = findStragglers({
      members: groupState.members,
      target: leaderCoordinates,
      thresholdM: thresholdM * 0.8,
      leaderUserId,
    });
    const overThresholdIds = new Set(overThreshold.map((s) => s.userId));
    const overReleaseIds = new Set(overRelease.map((s) => s.userId));

    const stillAlerting = new Set<string>();
    for (const userId of alertingRef.current) {
      if (overReleaseIds.has(userId)) stillAlerting.add(userId);
    }
    for (const userId of overThresholdIds) {
      stillAlerting.add(userId);
    }
    alertingRef.current = stillAlerting;

    return overRelease.filter((s) => stillAlerting.has(s.userId));
  }, [enabled, groupState, leaderCoordinates, leaderUserId]);

  return { stragglers };
}
