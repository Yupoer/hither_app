import { useEffect, useRef } from 'react';
import { liveActivity, type GroupActivityState } from '../native';

/**
 * Drive the iOS Live Activity (lock screen / Dynamic Island) from journey state.
 *
 * While `active` (the group's journey_status is 'going' and a gathering point
 * exists) this starts one Live Activity and keeps it updated with the latest
 * distance/ETA; when `active` flips false (pause / left group / no gathering) it
 * ends it. Everything is a safe no-op off iOS / in Expo Go — `liveActivity.*`
 * returns null/does nothing when the native module is absent (see
 * `native/liveActivity.ts`), so callers don't need to gate on platform.
 *
 * The native Live Activity is the system banner; the in-app Dynamic Island
 * mirrors the same data inside the map. Both read from the same source.
 */
export function useLiveActivity(active: boolean, state: GroupActivityState): void {
  const handleRef = useRef<string | null>(null);
  // Keep the latest desired state in a ref so the value-sync effect can read it
  // without re-running the start/stop lifecycle.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Start / end lifecycle, keyed only on `active`.
  useEffect(() => {
    let cancelled = false;
    if (active) {
      void (async () => {
        if (handleRef.current) return;
        const handle = await liveActivity.startGroupActivity(stateRef.current);
        if (cancelled) {
          // Component unmounted mid-start: end the orphaned activity.
          if (handle) void liveActivity.endGroupActivity(handle);
          return;
        }
        handleRef.current = handle;
      })();
    } else if (handleRef.current) {
      const handle = handleRef.current;
      handleRef.current = null;
      void liveActivity.endGroupActivity(handle);
    }
    return () => {
      cancelled = true;
    };
  }, [active]);

  // End any running activity on unmount.
  useEffect(() => {
    return () => {
      if (handleRef.current) {
        const handle = handleRef.current;
        handleRef.current = null;
        void liveActivity.endGroupActivity(handle);
      }
    };
  }, []);

  // Push value changes to a running activity. Round distance so tiny GPS jitter
  // doesn't spam updates; the dependency list collapses sub-10 m / sub-15 s noise.
  const roundedDistance =
    state.distanceMeters != null ? Math.round(state.distanceMeters / 10) * 10 : null;
  const roundedEta =
    state.etaSeconds != null ? Math.round(state.etaSeconds / 15) * 15 : null;
  // Coarse progress bucket so the bar advances without spamming updates.
  const progressBucket =
    state.progress != null ? Math.round(state.progress * 20) : null;

  useEffect(() => {
    if (active && handleRef.current) {
      void liveActivity.updateGroupActivity(handleRef.current, stateRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    roundedDistance,
    roundedEta,
    progressBucket,
    state.gatheredCount,
    state.memberCount,
    state.gatheringTitle,
    state.groupName,
    state.accentHex,
    state.travelMode,
  ]);
}
