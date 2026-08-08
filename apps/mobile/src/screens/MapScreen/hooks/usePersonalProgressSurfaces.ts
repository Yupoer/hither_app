import { useRef } from 'react';
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
  if (resetKeyRef.current !== input.resetKey) {
    resetKeyRef.current = input.resetKey;
    anchorRef.current = null;
  }

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

  return {
    personalProgress,
    gatheringCard: sharedValues,
    liveActivityPayload: sharedValues,
    routeAnchor: anchor,
    isNewRouteResult,
  };
}
