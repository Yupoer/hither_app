/**
 * Shared local personal progress model.
 *
 * One pure derivation from the latest accepted local coordinates + active
 * gathering target. Gathering card, My Progress, and Live Activity must all
 * read this model — backend location cadence is independent and never blocks
 * local display.
 */
import type { Coordinates } from '../types';
import {
  distanceMeters,
  etaSecondsFor,
  type TravelMode,
} from './geo';
import {
  gatedJourneyProgress,
  journeyProgress,
  hasArrived,
  ARRIVAL_RADIUS_M,
  capPreArrivalProgress,
  monotonicProgress,
} from './journeyProgress';

export type ProgressFreshness = 'live' | 'stale' | 'unknown';

export interface PersonalProgressInput {
  /** Latest accepted local device coordinates (UI-gated). */
  deviceCoords: Coordinates | null | undefined;
  /** Active gathering / navigation target. */
  targetCoords: Coordinates | null | undefined;
  /** Locked journey baseline distance (route or straight). */
  initialDistanceM?: number | null;
  /** Start pin used for departure gate; omit to skip gate. */
  startCoords?: Coordinates | null;
  /** Sticky departed flag from prior samples. */
  hasDepartedStart?: boolean;
  travelMode: TravelMode;
  /** Prefer route ETA when available; otherwise straight-line model. */
  routeEtaSeconds?: number | null;
  /** Prefer route remaining distance when same metric as baseline. */
  routeDistanceM?: number | null;
  /** Distance source locked with initial baseline. */
  distanceSource?: 'route' | 'fallback' | null;
  /** Last known route distance when current sample has no route. */
  lastRouteDistanceM?: number | null;
  /**
   * GPS position when the last route remaining sample was taken.
   * Used to estimate remaining distance between throttled route results.
   */
  routeAnchorGps?: Coordinates | null;
  /** Remaining metres at routeAnchorGps (usually lastRouteDistanceM). */
  routeAnchorRemainingM?: number | null;
  /**
   * Generation of the current directions result (bumped on every accepted
   * MapKit/network completion). Compared to routeAnchorGeneration so a fresh
   * result that returns the same integer metres still snaps/re-anchors.
   */
  routeResultGeneration?: number | null;
  /** Generation stored with the current GPS route anchor. */
  routeAnchorGeneration?: number | null;
  /** Sticky max progress for this destination (monotonic milestone). */
  previousProgressMax?: number | null;
  /** Last valid presentation values retained across GPS/route gaps. */
  lastValidDistanceM?: number | null;
  lastValidEtaSeconds?: number | null;
  lastValidProgress?: number | null;
  /** Authoritative personal arrival (check-in / auto-arrive). */
  arrived?: boolean;
  /** Authoritative stop completion (team completed). */
  completed?: boolean;
  /** Arrival geofence radius (tools slider). */
  arrivalRadiusM?: number;
  /**
   * Age of the last accepted UI sample in ms. When > staleAfterMs, keep last
   * valid numbers but mark freshness stale.
   */
  sampleAgeMs?: number | null;
  /** Default 30s — temporary GPS loss retains last values. */
  staleAfterMs?: number;
}

/**
 * Between throttled MapKit/network route results, estimate remaining route
 * metres from ground movement since the last route sample.
 */
export function estimateRemainingFromGpsMove(opts: {
  lastRouteRemainingM: number;
  lastRouteAt: Coordinates;
  currentGps: Coordinates;
}): number {
  const remaining = opts.lastRouteRemainingM;
  if (!Number.isFinite(remaining) || remaining < 0) return 0;
  const moved = distanceMeters(opts.lastRouteAt, opts.currentGps);
  if (!Number.isFinite(moved) || moved < 0) return remaining;
  return Math.max(0, remaining - moved);
}

/** GPS + remaining metres + directions generation for between-route estimates. */
export type RouteAnchorState = {
  gps: Coordinates;
  remainingM: number;
  generation: number;
};

/**
 * MapScreen re-anchor seam: treat a directions completion as fresh when its
 * generation differs from the stored anchor — even if remaining metres match.
 */
export function nextRouteAnchorFromResult(
  prev: RouteAnchorState | null,
  opts: {
    deviceCoords: Coordinates;
    routeDistanceM: number;
    selfRouteGeneration: number;
  },
): { anchor: RouteAnchorState; isNew: boolean } {
  const isNew = !prev || prev.generation !== opts.selfRouteGeneration;
  if (!isNew && prev) {
    return { anchor: prev, isNew: false };
  }
  return {
    anchor: {
      gps: opts.deviceCoords,
      remainingM: opts.routeDistanceM,
      generation: opts.selfRouteGeneration,
    },
    isNew: true,
  };
}

export interface PersonalProgressModel {
  distanceMeters: number | null;
  etaSeconds: number | null;
  /** 0–1 progress; null when unknown (no baseline / no target). */
  progress: number | null;
  freshness: ProgressFreshness;
  arrived: boolean;
  completed: boolean;
}

function sameMetricDistance(
  source: 'route' | 'fallback' | null | undefined,
  routeM: number | null | undefined,
  straightM: number | null | undefined,
  lastRouteM?: number | null,
): number | null {
  if (source === 'route') {
    if (routeM != null && Number.isFinite(routeM) && routeM >= 0) return routeM;
    if (lastRouteM != null && Number.isFinite(lastRouteM) && lastRouteM >= 0) {
      return lastRouteM;
    }
    return null;
  }
  if (straightM != null && Number.isFinite(straightM) && straightM >= 0) {
    return straightM;
  }
  return null;
}

/**
 * Derive personal distance / ETA / progress from local samples only.
 * Pure — no I/O, watchers, or backend round trips.
 */
export function derivePersonalProgress(
  input: PersonalProgressInput,
): PersonalProgressModel {
  const completed = Boolean(input.completed);
  const arrivalRadius = input.arrivalRadiusM ?? ARRIVAL_RADIUS_M;
  const staleAfter = input.staleAfterMs ?? 30_000;

  if (completed) {
    return {
      distanceMeters: 0,
      etaSeconds: 0,
      progress: 1,
      freshness: 'live',
      arrived: true,
      completed: true,
    };
  }

  const hasTarget =
    input.targetCoords != null
    && Number.isFinite(input.targetCoords.latitude)
    && Number.isFinite(input.targetCoords.longitude);

  if (!hasTarget) {
    return {
      distanceMeters: null,
      etaSeconds: null,
      progress: null,
      freshness: 'unknown',
      arrived: Boolean(input.arrived),
      completed: false,
    };
  }

  const target = input.targetCoords as Coordinates;
  const hasDevice =
    input.deviceCoords != null
    && Number.isFinite(input.deviceCoords.latitude)
    && Number.isFinite(input.deviceCoords.longitude);

  const straightM = hasDevice
    ? distanceMeters(input.deviceCoords as Coordinates, target)
    : null;

  // Local GPS estimate between throttled route results (before correction).
  // Always compute when we have an anchor — production keeps a finite stale
  // routeDistanceM between MapKit/network samples, so we must not gate on null.
  let gpsEstimatedRemaining: number | null = null;
  if (
    hasDevice
    && input.distanceSource === 'route'
    && input.routeAnchorGps != null
    && input.routeAnchorRemainingM != null
    && Number.isFinite(input.routeAnchorRemainingM)
  ) {
    gpsEstimatedRemaining = estimateRemainingFromGpsMove({
      lastRouteRemainingM: input.routeAnchorRemainingM,
      lastRouteAt: input.routeAnchorGps,
      currentGps: input.deviceCoords as Coordinates,
    });
  }

  const routeMFinite =
    input.routeDistanceM != null
    && Number.isFinite(input.routeDistanceM)
    && input.routeDistanceM >= 0
      ? input.routeDistanceM
      : null;

  // Fresh route result → snap. Prefer generation/identity over distance equality:
  // directions often return the same integer metres for a new routed origin/ETA.
  const hasGenerationPair =
    input.routeResultGeneration != null
    && Number.isFinite(input.routeResultGeneration)
    && input.routeAnchorGeneration != null
    && Number.isFinite(input.routeAnchorGeneration);
  const generationIsFresh =
    hasGenerationPair
    && input.routeResultGeneration !== input.routeAnchorGeneration;
  const distanceIsFresh =
    input.routeAnchorRemainingM == null
    || !Number.isFinite(input.routeAnchorRemainingM)
    || (routeMFinite != null && routeMFinite !== input.routeAnchorRemainingM);
  const routeIsFreshSnap =
    routeMFinite != null
    && (generationIsFresh || (!hasGenerationPair && distanceIsFresh));

  let liveDistance: number | null = null;
  if (input.distanceSource === 'route') {
    if (routeIsFreshSnap && routeMFinite != null) {
      liveDistance = routeMFinite;
    } else if (gpsEstimatedRemaining != null) {
      liveDistance = gpsEstimatedRemaining;
    } else {
      liveDistance = sameMetricDistance(
        input.distanceSource,
        input.routeDistanceM,
        straightM,
        input.lastRouteDistanceM,
      );
    }
  } else {
    liveDistance = sameMetricDistance(
      input.distanceSource,
      input.routeDistanceM,
      straightM,
      gpsEstimatedRemaining ?? input.lastRouteDistanceM,
    );
  }

  // When no locked source yet, prefer route then straight.
  let distanceMetersValue =
    liveDistance
    ?? routeMFinite
    ?? gpsEstimatedRemaining
    ?? straightM;

  const usedGpsLocalEstimate =
    gpsEstimatedRemaining != null
    && input.routeAnchorRemainingM != null
    // A newly accepted route result re-anchors at the current GPS sample.
    // Until the next sample moves from that anchor, keep the route ETA rather
    // than replacing it with a generic mode estimate for zero movement.
    && Math.abs(gpsEstimatedRemaining - input.routeAnchorRemainingM) > 0.01
    && distanceMetersValue === gpsEstimatedRemaining
    && !routeIsFreshSnap;

  // No live sample: retain last valid presentation (no zero / regress).
  if (
    distanceMetersValue == null
    && input.lastValidDistanceM != null
    && Number.isFinite(input.lastValidDistanceM)
  ) {
    distanceMetersValue = input.lastValidDistanceM;
  }

  const geofenceArrived =
    straightM != null && hasArrived(straightM, arrivalRadius);
  const arrived = Boolean(input.arrived) || geofenceArrived;

  if (arrived) {
    return {
      distanceMeters: distanceMetersValue ?? 0,
      etaSeconds: 0,
      progress: 1,
      freshness: hasDevice ? 'live' : 'stale',
      arrived: true,
      completed: false,
    };
  }

  // Full GPS loss with only sticky last-valid fields.
  if (!hasDevice && distanceMetersValue === input.lastValidDistanceM) {
    const stickyProgress =
      input.lastValidProgress != null && Number.isFinite(input.lastValidProgress)
        ? capPreArrivalProgress(
            monotonicProgress(
              input.lastValidProgress,
              input.previousProgressMax,
            ) ?? input.lastValidProgress,
          )
        : monotonicProgress(null, input.previousProgressMax);
    return {
      distanceMeters: distanceMetersValue,
      etaSeconds:
        input.lastValidEtaSeconds != null && Number.isFinite(input.lastValidEtaSeconds)
          ? Math.max(0, input.lastValidEtaSeconds)
          : distanceMetersValue != null
            ? etaSecondsFor(distanceMetersValue, input.travelMode)
            : null,
      progress: stickyProgress,
      freshness: distanceMetersValue != null ? 'stale' : 'unknown',
      arrived: false,
      completed: false,
    };
  }

  let freshness: ProgressFreshness = 'unknown';
  if (hasDevice) {
    const age = input.sampleAgeMs;
    if (age == null || !Number.isFinite(age) || age <= staleAfter) {
      freshness = 'live';
    } else {
      freshness = 'stale';
    }
  } else if (distanceMetersValue != null) {
    freshness = 'stale';
  }

  const usedStickyDistance =
    !hasDevice
    || (
      liveDistance == null
      && straightM == null
      && (input.routeDistanceM == null || !Number.isFinite(input.routeDistanceM))
      && gpsEstimatedRemaining == null
    );

  // Between-route GPS estimate: recompute ETA from distance (stale route ETA lies).
  // Fresh route snap may keep routeEtaSeconds when provided.
  const etaSeconds =
    distanceMetersValue == null
      ? input.lastValidEtaSeconds != null && Number.isFinite(input.lastValidEtaSeconds)
        ? Math.max(0, input.lastValidEtaSeconds)
        : null
      : usedGpsLocalEstimate
        ? etaSecondsFor(distanceMetersValue, input.travelMode)
        : input.routeEtaSeconds != null && Number.isFinite(input.routeEtaSeconds)
          ? Math.max(0, input.routeEtaSeconds)
          : usedStickyDistance
            && input.lastValidEtaSeconds != null
            && Number.isFinite(input.lastValidEtaSeconds)
            && distanceMetersValue === input.lastValidDistanceM
            ? Math.max(0, input.lastValidEtaSeconds)
            : etaSecondsFor(distanceMetersValue, input.travelMode);

  let progress: number | null = null;
  const initialM = input.initialDistanceM;
  if (
    distanceMetersValue != null
    && initialM != null
    && Number.isFinite(initialM)
    && initialM > 0
  ) {
    if (input.startCoords && hasDevice) {
      const movedFromStartM = distanceMeters(
        input.startCoords,
        input.deviceCoords as Coordinates,
      );
      progress = gatedJourneyProgress({
        initialM,
        currentM: distanceMetersValue,
        movedFromStartM,
        hasDepartedStart: input.hasDepartedStart,
      }).progress;
    } else {
      progress = journeyProgress(initialM, distanceMetersValue);
    }
    progress = capPreArrivalProgress(progress);
  } else if (
    input.lastValidProgress != null
    && Number.isFinite(input.lastValidProgress)
  ) {
    progress = capPreArrivalProgress(input.lastValidProgress);
  }

  progress = monotonicProgress(progress, input.previousProgressMax);
  if (progress != null) {
    progress = capPreArrivalProgress(progress);
  }

  return {
    distanceMeters: distanceMetersValue,
    etaSeconds,
    progress,
    freshness,
    arrived: false,
    completed: false,
  };
}
