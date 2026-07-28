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

  const liveDistance = sameMetricDistance(
    input.distanceSource,
    input.routeDistanceM,
    straightM,
    input.lastRouteDistanceM,
  );

  // When no locked source yet, prefer route then straight.
  const distanceMetersValue =
    liveDistance
    ?? (input.routeDistanceM != null
      && Number.isFinite(input.routeDistanceM)
      && input.routeDistanceM >= 0
      ? input.routeDistanceM
      : null)
    ?? straightM;

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

  const etaSeconds =
    distanceMetersValue == null
      ? null
      : input.routeEtaSeconds != null && Number.isFinite(input.routeEtaSeconds)
        ? Math.max(0, input.routeEtaSeconds)
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
    progress = Math.min(1, Math.max(0, progress));
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
