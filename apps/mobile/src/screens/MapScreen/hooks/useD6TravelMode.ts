import { createElement, Fragment, useState, useSyncExternalStore, type ReactElement } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { observeMotionTravelMode } from '../../../native/location';
import { getTravelETA } from '../../../native/maps';
import { isForegroundUi, subscribeForegroundUi } from '../../../state/foregroundUi';
import type { Coordinates, Destination } from '../../../types';
import { distanceMeters, etaSecondsFor, type TravelMode } from '../../../utils/geo';
import { majorityMotionMode, needsTransitETA, reconcileTravelOverride, resolveAutomaticTravelMode,
  type MotionReport, type TravelOverride } from '../d6TravelMode';

interface TravelModeInput {
  enabled: boolean;
  fallbackMode: TravelMode;
  setFallbackMode: (mode: TravelMode) => void;
  canSetOverride: boolean;
  journeyKey?: string | null;
  activeJourneyId?: string | null;
  target?: Pick<Destination, 'id' | 'coordinates' | 'meetAt'> | null;
  memberCount: number;
  selfUserId?: string | null;
  sharingEnabled: boolean;
  origin?: Coordinates | null;
  foreground?: boolean;
  showModeEtas?: boolean;
  serverTimeOffsetMs?: number;
}

interface TravelModeState {
  travelMode: TravelMode;
  selectedMode: TravelMode | 'auto';
  setTravelMode: (mode: TravelMode | 'auto') => void;
  etaByMode: Record<TravelMode, number | null>;
  etaSeconds: number | null;
  lifecycle: ReactElement;
}

const MODES: readonly TravelMode[] = ['walk', 'transit', 'drive', 'bicycle'];
const EMPTY_ETAS: Record<TravelMode, number | null> = { walk: null, transit: null, drive: null, bicycle: null };
const ETA_REFRESH_MS = 2 * 60_000;
const ETA_RETRY_MS = 30_000;
const ETA_ORIGIN_CHANGE_M = 125;

interface ETAPath {
  key: string;
  targetKey: string;
  from: Coordinates;
  to: Coordinates;
}

interface ETAResult {
  key: string;
  seconds: number | null;
  expiresAt: number;
}

function coordinatesAreValid(coordinates: Coordinates): boolean {
  return Math.abs(coordinates.latitude) <= 90 && Math.abs(coordinates.longitude) <= 180;
}

export function useD6TravelMode({
  enabled, fallbackMode, setFallbackMode, canSetOverride, journeyKey, activeJourneyId,
  target, memberCount, selfUserId, sharingEnabled, origin, foreground = true,
  showModeEtas = false, serverTimeOffsetMs = 0,
}: TravelModeInput): TravelModeState {
  const foregroundUi = useSyncExternalStore(subscribeForegroundUi, isForegroundUi, isForegroundUi);
  const lane = enabled && journeyKey && selfUserId ? JSON.stringify([journeyKey, selfUserId]) : null;
  const [override, setOverride] = useState<TravelOverride | null>(null);
  const appliedOverride = reconcileTravelOverride(override, { lane: canSetOverride ? lane : null, activeJourneyId });
  if (appliedOverride !== override) setOverride(appliedOverride);
  const selectedMode = appliedOverride?.mode ?? 'auto';
  const setTravelMode = (mode: TravelMode | 'auto') => {
    if (!enabled) {
      if (mode !== 'auto') setFallbackMode(mode);
      return;
    }
    if (!lane || !canSetOverride) return;
    setOverride(mode === 'auto' ? null : { lane, sessionId: activeJourneyId ?? null, mode });
  };

  const [now, setNow] = useState(Date.now);
  const [motion, setMotion] = useState<MotionReport | null>(null);
  const [path, setPath] = useState<ETAPath | null>(null);
  const [results, setResults] = useState<Partial<Record<TravelMode, ETAResult>>>({});
  const [cache] = useState(() => new Map<string, ETAResult>());

  const canUseOrigin = Boolean(lane && sharingEnabled && memberCount > 0);
  const canRequest = canUseOrigin && foreground && foregroundUi;
  const motionOwner = canUseOrigin && target && !appliedOverride && memberCount === 1 ? selfUserId : null;
  const majority = motionOwner && motion?.userId === motionOwner ? majorityMotionMode(memberCount, [motion]) : null;
  let activePath: ETAPath | null = null;
  let distanceM: number | null = null;
  if (canUseOrigin && origin && target && coordinatesAreValid(origin) && coordinatesAreValid(target.coordinates)) {
    const distance = distanceMeters(origin, target.coordinates);
    if (Number.isFinite(distance)) {
      const targetKey = JSON.stringify([lane, target.id, target.coordinates.latitude, target.coordinates.longitude]);
      distanceM = distance;
      activePath = path?.targetKey === targetKey && distanceMeters(path.from, origin) < ETA_ORIGIN_CHANGE_M
        ? path : { key: `${targetKey}:${origin.latitude}:${origin.longitude}`, targetKey, from: origin, to: target.coordinates };
    }
  }
  if (path !== activePath) setPath(activePath);

  const readETA = (mode: TravelMode): ETAResult | undefined => {
    const result = results[mode];
    return result && result.key === activePath?.key ? result : undefined;
  };
  const meetAt = target?.meetAt ? Date.parse(target.meetAt) : NaN;
  const remainingSeconds = Number.isFinite(meetAt) ? (meetAt - now - serverTimeOffsetMs) / 1_000 : undefined;
  const walkETA = readETA('walk')?.seconds;
  const transitETA = readETA('transit')?.seconds;
  const probeTransit = !appliedOverride && !majority && distanceM != null && needsTransitETA({ distanceM, walkETA, remainingSeconds });
  const travelMode = lane ? resolveAutomaticTravelMode({
    override: appliedOverride?.mode ?? null, majority, distanceM, walkETA, remainingSeconds, transitAvailable: transitETA != null,
  }) : fallbackMode;

  const etaByMode = { ...EMPTY_ETAS };
  const pendingTransitDecision = probeTransit && transitETA === undefined;
  const probeWalk = !appliedOverride && !majority && remainingSeconds != null;
  const requests = MODES.map(mode => {
    const requested = showModeEtas || (mode === 'transit' && probeTransit)
      || (mode === 'walk' && probeWalk) || (mode === travelMode && !pendingTransitDecision);
    if (!activePath || !requested || distanceM == null) return null;
    const eta = readETA(mode);
    if (distanceM < 10) {
      etaByMode[mode] = etaSecondsFor(distanceM, mode);
      return null;
    }
    if (eta) etaByMode[mode] = eta.seconds ?? etaSecondsFor(distanceM, mode);
    if (eta && eta.expiresAt > now) return null;
    if (!canRequest) return null;
    return createElement(TravelETAResource, { key: `${activePath.key}:${mode}`, mode, cache, path: activePath, setResults });
  });

  const lifecycle = createElement(Fragment, null,
    canRequest && motionOwner && createElement(TravelMotionResource, { key: lane, userId: motionOwner, setMotion }),
    canRequest && activePath && createElement(TravelETAClock, { key: activePath.key, setNow }),
    ...requests,
  );
  return { travelMode, selectedMode, setTravelMode, etaByMode, etaSeconds: etaByMode[travelMode], lifecycle };
}

function TravelMotionResource({ userId, setMotion }: {
  userId: string; setMotion: (report: MotionReport | null) => void;
}) {
  useMountEffect(() => {
    const unsubscribe = observeMotionTravelMode(mode => {
      setMotion(mode ? { mode, userId } : null);
    });
    return () => {
      unsubscribe();
      setMotion(null);
    };
  });
  return null;
}

function TravelETAClock({ setNow }: { setNow: (now: number) => void }) {
  useMountEffect(() => {
    function tick() { setNow(Date.now()); }
    const firstTick = setTimeout(tick, 0);
    const timer = setInterval(tick, 15_000);
    return () => {
      clearTimeout(firstTick);
      clearInterval(timer);
    };
  });
  return null;
}

function TravelETAResource({ cache, mode, path, setResults }: {
  cache: Map<string, ETAResult>;
  mode: TravelMode;
  path: ETAPath;
  setResults: React.Dispatch<React.SetStateAction<Partial<Record<TravelMode, ETAResult>>>>;
}) {
  useMountEffect(() => {
    const request = new AbortController();
    const cacheKey = `${path.key}:${mode}`;
    const timer = setTimeout(() => {
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        setResults(previous => ({ ...previous, [mode]: cached }));
        return;
      }
      void getTravelETA({ from: path.from, to: path.to, travelMode: mode, signal: request.signal }).then(seconds => {
        if (request.signal.aborted) return;
        const now = Date.now();
        const result = { key: path.key, seconds, expiresAt: now + (seconds == null ? ETA_RETRY_MS : ETA_REFRESH_MS) };
        for (const [key, entry] of cache) {
          if (entry.expiresAt <= now) cache.delete(key);
        }
        cache.set(cacheKey, result);
        while (cache.size > 24) {
          const oldest = cache.keys().next();
          if (oldest.done) break;
          cache.delete(oldest.value);
        }
        setResults(previous => ({ ...previous, [mode]: result }));
      });
    }, 400);
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  });
  return null;
}
