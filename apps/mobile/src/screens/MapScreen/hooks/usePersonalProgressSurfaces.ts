import { useRef } from 'react';
import { resolveEtaSnapshot, type EtaSnapshot } from '../../../utils/liveActivityEta';
import {
  derivePersonalProgress,
  nextRouteAnchorFromResult,
  type PersonalProgressInput,
  type PersonalProgressModel,
  type RouteAnchorState,
} from '../../../utils/personalProgress';

export interface PersonalProgressSurfaceValues {
  distanceMeters: number | null;
  etaSeconds: number | null;
  progress: number | null;
  etaTargetAtMs?: number;
  etaSampledAtMs?: number;
}

export type PersonalProgressSurfaces = {
  personalProgress: PersonalProgressModel;
  /** Values consumed by the active gathering card. */
  gatheringCard: PersonalProgressSurfaceValues;
  /** Values passed to useLiveActivity for the native payload. */
  liveActivityPayload: PersonalProgressSurfaceValues;
  /** Current route anchor, retained until a newer route generation arrives. */
  routeAnchor: RouteAnchorState | null;
  isNewRouteResult: boolean;
};

export type PersonalProgressSurfaceInput = Omit<
  PersonalProgressInput,
  'routeAnchorGps'
  | 'routeAnchorRemainingM'
  | 'routeResultGeneration'
  | 'routeAnchorGeneration'
> & {
  /** Reset anchor and presentation state when the journey/target changes. */
  resetKey?: string | null;
  /** Accepted route result identity; equal metres can still be a new result. */
  routeResultGeneration?: number | null;
  sampledAtMs?: number;
  /** Fallbacks used when the shared model has no current value. */
  fallbackDistanceM?: number | null;
  fallbackEtaSeconds?: number | null;
  fallbackProgress?: number | null;
};

/**
 * Production MapScreen orchestration seam for local personal progress.
 *
 * It owns route-result freshness, the GPS anchor, and the single model that
 * feeds both the gathering card and the Live Activity payload. Keeping this
 * seam in a hook lets integration tests drive accepted route completions and
 * consumer values without reproducing private MapScreen state by hand.
 */
export function usePersonalProgressSurfaces(
  input: PersonalProgressSurfaceInput,
): PersonalProgressSurfaces {
  const anchorRef = useRef<RouteAnchorState | null>(null);
  const resetKeyRef = useRef(input.resetKey);
  const travelModeRef = useRef(input.travelMode);
  const modeChanged = travelModeRef.current !== input.travelMode;
  travelModeRef.current = input.travelMode;
  const etaSnapshotRef = useRef<EtaSnapshot | null>(null);
  const resetChanged = resetKeyRef.current !== input.resetKey;
  if (resetChanged) {
    resetKeyRef.current = input.resetKey;
    anchorRef.current = null;
    etaSnapshotRef.current = null;
  }

  // Keep distance/progress anchors when changing transport; only ETA loses ownership.
  if (modeChanged) etaSnapshotRef.current = null;

  const routeGeneration = input.routeResultGeneration ?? 0;
  let isNewRouteResult = false;
  if (
    input.deviceCoords != null
    && input.routeDistanceM != null
    && Number.isFinite(input.routeDistanceM)
    && input.routeDistanceM >= 0
  ) {
    const next = nextRouteAnchorFromResult(anchorRef.current, {
      deviceCoords: input.deviceCoords,
      routeDistanceM: input.routeDistanceM,
      selfRouteGeneration: routeGeneration,
    });
    if (next.isNew) {
      anchorRef.current = next.anchor;
      isNewRouteResult = true;
    }
  }

  const anchor = anchorRef.current;
  const personalProgress = derivePersonalProgress({
    ...input,
    previousProgressMax: resetChanged ? null : input.previousProgressMax,
    lastValidDistanceM: resetChanged ? null : input.lastValidDistanceM,
    lastValidEtaSeconds: resetChanged || modeChanged ? null : input.lastValidEtaSeconds,
    lastValidProgress: resetChanged ? null : input.lastValidProgress,
    routeAnchorGps: anchor?.gps,
    routeAnchorRemainingM: anchor?.remainingM,
    routeResultGeneration: routeGeneration,
    routeAnchorGeneration: anchor?.generation,
  });
  const sharedValues: PersonalProgressSurfaceValues = {
    distanceMeters:
      personalProgress.distanceMeters ?? input.fallbackDistanceM ?? null,
    etaSeconds:
      personalProgress.etaSeconds ?? input.fallbackEtaSeconds ?? null,
    progress: personalProgress.progress ?? input.fallbackProgress ?? null,
  };
  etaSnapshotRef.current = resolveEtaSnapshot(etaSnapshotRef.current, {
    key: JSON.stringify([input.resetKey, input.travelMode, routeGeneration, sharedValues.distanceMeters, sharedValues.etaSeconds, input.arrivalRadiusM]),
    etaSeconds: sharedValues.etaSeconds,
    sampledAtMs: isNewRouteResult || modeChanged ? undefined : input.sampledAtMs,
    nowMs: Date.now(),
    fresh: modeChanged || personalProgress.arrived || personalProgress.freshness === 'live',
  });
  sharedValues.etaTargetAtMs = etaSnapshotRef.current?.etaTargetAtMs;
  sharedValues.etaSampledAtMs = etaSnapshotRef.current?.sampledAtMs;

  return {
    personalProgress,
    gatheringCard: sharedValues,
    liveActivityPayload: sharedValues,
    routeAnchor: anchor,
    isNewRouteResult,
  };
}
