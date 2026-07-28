/**
 * Active destination marker pulse — pure helpers for cadence / cleanup.
 *
 * Animation runs once per five-second cycle on the active target only.
 * Continuous marker bitmap tracking must stay off after each pulse.
 */

export const TARGET_PULSE_INTERVAL_MS = 5_000;
/** Brief pulse duration (ms). tracksViewChanges only for this window. */
export const TARGET_PULSE_DURATION_MS = 420;

export interface TargetPulsePhase {
  /** 0 = idle static; 1 = pulse peak. */
  scale: number;
  active: boolean;
}

/**
 * Whether the marker for `destId` should run the pulse cycle.
 * Completed / non-target markers stay static.
 */
export function shouldPulseDestination(input: {
  destId: string;
  activeDestinationId: string | null | undefined;
  completedDestinationIds?: ReadonlySet<string> | ReadonlyArray<string> | null;
  /** App in background / inactive — stop pulse. */
  appActive?: boolean;
  reduceMotion?: boolean;
}): boolean {
  if (input.reduceMotion) return false;
  if (input.appActive === false) return false;
  const activeId = input.activeDestinationId;
  if (!activeId || activeId !== input.destId) return false;
  const completed = input.completedDestinationIds;
  if (completed) {
    if (completed instanceof Set) {
      if (completed.has(input.destId)) return false;
    } else if ((completed as readonly string[]).includes(input.destId)) {
      return false;
    }
  }
  return true;
}

/**
 * Static emphasis when Reduce Motion is on: slightly larger ring, no animation.
 */
export function reduceMotionEmphasisScale(): number {
  return 1.12;
}

/** Peak scale during the brief pulse. */
export function pulsePeakScale(): number {
  return 1.22;
}
