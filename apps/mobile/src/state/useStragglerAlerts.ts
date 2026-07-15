import { useMemo, useRef } from 'react';
import { findStragglers, type Straggler } from '../utils/straggler';
import type { Coordinates, GroupState } from '../types';

interface UseStragglerAlertsResult {
  /** Members currently over the threshold. */
  stragglers: Straggler[];
}

export interface UseStragglerAlertsOptions {
  /**
   * Role gate — pass `false` for non-leaders so followers never run distance
   * logic (they only receive APNs from the leader device).
   */
  enabled?: boolean;
  leaderUserId?: string;
  /**
   * UI-first override for the on/off switch. When set, distance calc uses this
   * instead of waiting for `group.stragglerAlerts` from DB/realtime.
   */
  alertsEnabled?: boolean;
  /**
   * UI-first override for the distance threshold (meters). Same rationale as
   * `alertsEnabled` — toggle UI must not wait on DB round-trip.
   */
  thresholdM?: number;
}

/**
 * Leader-side straggler state. Wraps `findStragglers` with hysteresis:
 * a member who trips the threshold stays flagged until they close back inside
 * 80% of it. Data-only — callers fire APN via RPC. Pass `enabled: false` for
 * non-leaders so followers never run distance logic.
 *
 * Locations: member coords from group state (DB cache); leader GPS is
 * `leaderCoordinates` from the device. DB only stores the shared group setting
 * (on/off + threshold), not live distances.
 */
export function useStragglerAlerts(
  groupState: GroupState | null,
  leaderCoordinates: Coordinates | undefined,
  options?: UseStragglerAlertsOptions,
): UseStragglerAlertsResult {
  const roleEnabled = options?.enabled ?? true;
  const leaderUserId = options?.leaderUserId;
  const alertsOverride = options?.alertsEnabled;
  const thresholdOverride = options?.thresholdM;
  const alertingRef = useRef<Set<string>>(new Set());

  const stragglers = useMemo(() => {
    if (!roleEnabled || !groupState || !leaderCoordinates) {
      alertingRef.current = new Set();
      return [];
    }
    const alertsOn =
      alertsOverride !== undefined
        ? alertsOverride
        : groupState.group.stragglerAlerts;
    if (!alertsOn) {
      alertingRef.current = new Set();
      return [];
    }
    const thresholdM =
      thresholdOverride !== undefined
        ? thresholdOverride
        : groupState.group.stragglerThresholdM;
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
  }, [
    roleEnabled,
    groupState,
    leaderCoordinates,
    leaderUserId,
    alertsOverride,
    thresholdOverride,
  ]);

  return { stragglers };
}
