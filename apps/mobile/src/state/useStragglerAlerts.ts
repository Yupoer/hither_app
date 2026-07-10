import { useMemo, useRef } from 'react';
import { findStragglers, type Straggler } from '../utils/straggler';
import type { Coordinates, GroupState } from '../types';

interface UseStragglerAlertsResult {
  /** Members currently over the threshold. */
  stragglers: Straggler[];
}

/**
 * Straggler alert state for a group. Wraps `findStragglers` with hysteresis:
 * a member who trips the threshold stays flagged until they close back inside
 * 80% of it, so they don't flicker in/out near the boundary. Data-only — no
 * haptics or push here, callers decide how to surface it.
 */
export function useStragglerAlerts(
  groupState: GroupState | null,
  myCoordinates?: Coordinates,
): UseStragglerAlertsResult {
  // userIds currently considered "alerting" (hysteresis state).
  const alertingRef = useRef<Set<string>>(new Set());

  const stragglers = useMemo(() => {
    if (!groupState || !groupState.group.stragglerAlerts) {
      alertingRef.current = new Set();
      return [];
    }
    const thresholdM = groupState.group.stragglerThresholdM;
    // Two bands: the full threshold (who newly qualifies) and the release
    // band at 80% of it (who's still far enough to stay flagged). The release
    // list is always a superset of the threshold list.
    const overThreshold = findStragglers({
      members: groupState.members,
      target: myCoordinates,
      thresholdM,
    });
    const overRelease = findStragglers({
      members: groupState.members,
      target: myCoordinates,
      thresholdM: thresholdM * 0.8,
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
  }, [groupState, myCoordinates]);

  return { stragglers };
}
