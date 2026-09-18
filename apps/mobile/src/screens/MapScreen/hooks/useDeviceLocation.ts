import { useState, useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { location } from '../../../native';
import { setLocationAccessContext, captureLocationAccess, isLocationAccessCurrent } from '../../../state/locationPrivacy';
import { energyObservability } from '../../../state/energyObservability';
import {
  isDebugRouteActive,
  subscribeDebugLocation,
} from '../../../native/debugLocation';
import type { LocationSample } from '../../../native/location';
import type { Coordinates } from '../../../types';
import {
  enqueueLocationOutbox,
  flushLocationOutbox,
} from '../../../state/locationOutbox';
import {
  createMotionState,
  locationPolicy,
  reduceMotionState,
  shouldUploadSample,
  shouldWatchLocation,
  type LocationGateState,
  type MotionState,
} from '../../../utils/locationPolicy';

interface UseDeviceLocationParams {
  groupId: string | null | undefined;
  highAccuracy: boolean;
  /**
   * When true (iOS MapKit `showsUserLocation`), skip the second Expo
   * `watchPositionAsync` owner and consume MapKit samples instead.
   */
  nativeMapLocationEnabled?: boolean;
  sharingEnabled?: boolean;
  hasMembership?: boolean;
  teamNavigationActive?: boolean;
}

/** Coalesce passive outbox flushes; force-sync bypasses this delay. */
const OUTBOX_FLUSH_DELAY_MS = 20_000;

export function useDeviceLocation({
  groupId,
  highAccuracy,
  nativeMapLocationEnabled = false,
  sharingEnabled = true,
  hasMembership,
  teamNavigationActive = false,
}: UseDeviceLocationParams) {
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);
  const [deviceAccuracyM, setDeviceAccuracyM] = useState<number | null>(null);
  /** Wall-clock of last UI-accepted sample — drives progress freshness/stale. */
  const [deviceCoordsAcceptedAtMs, setDeviceCoordsAcceptedAtMs] = useState<number | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const lastSampleAtRef = useRef(0);
  const uiGateRef = useRef<LocationGateState>({ lastCoords: null, lastAtMs: 0 });
  const uploadGateRef = useRef<LocationGateState>({ lastCoords: null, lastAtMs: 0 });
  const motionRef = useRef<MotionState>(createMotionState());
  const outboxFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forceSyncInFlightRef = useRef(false);
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;
  const teamNavigationRef = useRef(teamNavigationActive);
  teamNavigationRef.current = teamNavigationActive;
  const highAccuracyRef = useRef(highAccuracy);
  highAccuracyRef.current = highAccuracy && teamNavigationActive;
  const deviceCoordsRef = useRef(deviceCoords);
  deviceCoordsRef.current = deviceCoords;
  const sharingEnabledRef = useRef(sharingEnabled);
  sharingEnabledRef.current = sharingEnabled;
  const hasMembershipResolved = hasMembership ?? Boolean(groupId);
  const hasMembershipRef = useRef(hasMembershipResolved);
  hasMembershipRef.current = hasMembershipResolved;
  const watchAllowed = (state: string = appState) =>
    shouldWatchLocation(
      groupId ?? null,
      state,
      sharingEnabledRef.current,
      hasMembershipRef.current,
    );

  useEffect(() => {
    setLocationAccessContext(hasMembershipResolved ? groupId ?? null : null, sharingEnabled, appState === 'active');
  }, [groupId, hasMembershipResolved, sharingEnabled, appState]);
  useEffect(() => () => setLocationAccessContext(null, false), []);

  const policyNow = () => locationPolicy(teamNavigationRef.current, teamNavigationRef.current ? 'journey' : 'foreground');

  const scheduleOutboxFlush = useCallback(() => {
    if (outboxFlushTimerRef.current) return;
    outboxFlushTimerRef.current = setTimeout(() => {
      outboxFlushTimerRef.current = null;
      void flushLocationOutbox().catch(() => undefined);
    }, OUTBOX_FLUSH_DELAY_MS);
  }, []);

  const applySampleToUi = useCallback((sample: LocationSample, now: number) => {
    const coords = sample.coordinates;
    if (!groupIdRef.current || !sharingEnabledRef.current || !hasMembershipRef.current || AppState.currentState !== 'active'
      || !Number.isFinite(sample.timestamp) || sample.timestamp <= lastSampleAtRef.current
      || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)
      || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) return false;
    lastSampleAtRef.current = sample.timestamp;
    setDeviceCoords(coords);
    setDeviceAccuracyM(
      sample.accuracy != null && Number.isFinite(sample.accuracy) ? sample.accuracy : null,
    );
    setDeviceCoordsAcceptedAtMs(Math.min(now, sample.timestamp));
    uiGateRef.current = { lastCoords: coords, lastAtMs: now };
    return true;
  }, []);

  const enqueueUpload = useCallback(
    async (
      sample: LocationSample,
      now: number,
      options: { immediate: boolean },
    ): Promise<void> => {
      const gid = groupIdRef.current;
      if (!gid || !sharingEnabledRef.current || !hasMembershipRef.current) return;
      const access = await captureLocationAccess(gid);
      if (!access) return;
      await enqueueLocationOutbox({
        groupId: gid,
        coordinates: {
          ...sample.coordinates,
          ...(sample.accuracy != null && Number.isFinite(sample.accuracy)
            ? { accuracy: sample.accuracy }
            : {}),
        },
        capturedAt: sample.timestamp,
      });
      if (!isLocationAccessCurrent(access)) return;
      uploadGateRef.current = {
        lastCoords: sample.coordinates,
        lastAtMs: now,
      };
      if (options.immediate) {
        if (outboxFlushTimerRef.current) {
          clearTimeout(outboxFlushTimerRef.current);
          outboxFlushTimerRef.current = null;
        }
        await flushLocationOutbox();
      } else {
        scheduleOutboxFlush();
      }
    },
    [scheduleOutboxFlush],
  );

  /**
   * Apply one foreground sample (MapKit or Expo watch) through existing UI/upload gates.
   * Never calls getCurrentLocation — caller owns the sample source.
   */
  const consumeForegroundSample = useCallback(
    (sample: LocationSample): void => {
      energyObservability.increment('location_callback');
      const now = Date.now();
      const policy = policyNow();
      const coords = sample.coordinates;
      if (!applySampleToUi(sample, now)) return;
      motionRef.current = reduceMotionState(motionRef.current, coords, now, policy, sample.accuracy ?? 0);

      energyObservability.increment('location_accepted');
      energyObservability.event('location_acquisition');

      if (
        groupIdRef.current &&
        sharingEnabledRef.current &&
        hasMembershipRef.current &&
        shouldUploadSample(
          coords,
          now,
          uploadGateRef.current,
          policy,
          motionRef.current.cadence,
        )
      ) {
        void enqueueUpload(sample, now, { immediate: teamNavigationRef.current }).catch(() => undefined);
      }
    },
    [applySampleToUi, enqueueUpload],
  );

  /**
   * Force one-shot GPS + immediate upload (manual refresh / foreground resume).
   * Bypasses distance/time gates — "force sync".
   *
   * @param options.requireUpload When true (Force Refresh), upload failures
   *   propagate so callers can stop peer fan-out and show failure feedback.
   *   Background/foreground auto paths keep soft-fail upload.
   */
  const refreshDeviceLocation = useCallback(async (options?: {
    requireUpload?: boolean;
  }): Promise<Coordinates | null> => {
    energyObservability.increment('location_callback');
    const requestedGroup = groupIdRef.current;
    if (!requestedGroup || !sharingEnabledRef.current || !hasMembershipRef.current || AppState.currentState !== 'active') return null;
    const access = await captureLocationAccess(requestedGroup);
    if (!access) return null;
    const fix = await location.getCurrentLocation(highAccuracyRef.current);
    if (!fix || !isLocationAccessCurrent(access) || !sharingEnabledRef.current || requestedGroup !== groupIdRef.current || !groupIdRef.current || !hasMembershipRef.current || AppState.currentState !== 'active') return null;
    energyObservability.increment('location_accepted');
    energyObservability.event('location_acquisition');
    const now = Date.now();
    if (!applySampleToUi(fix, now)) return deviceCoordsRef.current;
    motionRef.current = reduceMotionState(
      motionRef.current,
      fix.coordinates,
      now,
      policyNow(),
      fix.accuracy ?? 0,
    );
    if (groupIdRef.current && sharingEnabledRef.current && hasMembershipRef.current) {
      if (options?.requireUpload) {
        await enqueueUpload(fix, now, { immediate: true });
      } else {
        await enqueueUpload(fix, now, { immediate: true }).catch(() => undefined);
      }
    }
    return fix.coordinates;
  }, [applySampleToUi, enqueueUpload]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  // Reset gates when profile changes so the next sample is accepted immediately.
  useEffect(() => {
    uiGateRef.current = { lastCoords: null, lastAtMs: 0 };
    uploadGateRef.current = { lastCoords: null, lastAtMs: 0 };
    motionRef.current = createMotionState(Date.now());
  }, [highAccuracy, teamNavigationActive, groupId]);

  // Foreground force-sync: open app / return from background → upload now.
  useEffect(() => {
    if (nativeMapLocationEnabled || !groupId || appState !== 'active' || !sharingEnabled || !hasMembershipResolved) return;
    if (forceSyncInFlightRef.current) return;
    forceSyncInFlightRef.current = true;
    void refreshDeviceLocation()
      .catch(() => null)
      .finally(() => {
        forceSyncInFlightRef.current = false;
      });
  }, [appState, groupId, refreshDeviceLocation, sharingEnabled, hasMembershipResolved, nativeMapLocationEnabled]);

  useEffect(() => {
    if (groupId && appState === 'active' && sharingEnabled && hasMembershipResolved) {
      void flushLocationOutbox().catch(() => undefined);
    }
  }, [appState, groupId, sharingEnabled, hasMembershipResolved]);

  // No GPS heartbeat: publish only timestamped sensor fixes, never retimestamp a cache.
  useEffect(() => () => {
    if (outboxFlushTimerRef.current) clearTimeout(outboxFlushTimerRef.current);
    outboxFlushTimerRef.current = null;
  }, [appState, groupId, sharingEnabled, hasMembershipResolved]);

  // DEV debug route: always feed samples into UI, even when MapKit owns real GPS.
  // Debug samples stay local — they must not enter the team location outbox.
  useEffect(() => {
    if (!watchAllowed(appState)) return;
    return subscribeDebugLocation((sample: LocationSample) => {
      if (!isDebugRouteActive()) return;
      const now = Date.now();
      const policy = policyNow();
      motionRef.current = reduceMotionState(
        motionRef.current,
        sample.coordinates,
        now,
        policy,
      );
      applySampleToUi(sample, now);
    });
  }, [appState, groupId, applySampleToUi, sharingEnabled, hasMembershipResolved]);

  // Expo watch is fallback only when MapKit is not the foreground owner.
  useEffect(() => {
    if (nativeMapLocationEnabled) return;
    if (!watchAllowed(appState)) return;
    let cancelled = false;
    let stop = () => {};
    void location
      .watchLocation((sample: LocationSample) => {
        consumeForegroundSample(sample);
      }, teamNavigationActive)
      .then((unsub: () => void) => {
        if (cancelled) unsub();
        else stop = unsub;
      });
    return () => {
      cancelled = true;
      if (outboxFlushTimerRef.current) {
        clearTimeout(outboxFlushTimerRef.current);
        outboxFlushTimerRef.current = null;
      }
      stop();
    };
  }, [appState, groupId, highAccuracy, teamNavigationActive, nativeMapLocationEnabled, consumeForegroundSample, sharingEnabled, hasMembershipResolved]);

  return {
    deviceCoords,
    /** Horizontal accuracy of the last accepted device fix, metres. */
    deviceAccuracyM,
    /** When the last UI-accepted sample was applied (ms since epoch). */
    deviceCoordsAcceptedAtMs,
    /** Exposed so MapScreen can own a single GPS path (FG watch vs BG task). */
    appState,
    refreshDeviceLocation,
    consumeForegroundSample,
  };
}
