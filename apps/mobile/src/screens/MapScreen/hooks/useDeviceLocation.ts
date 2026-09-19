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
  shouldAcceptUiSample,
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
  /**
   * Receives every valid, fresh foreground sensor fix before React UI
   * projection throttling. The coordinator can use this for arrival and
   * target state without making the map re-render at GPS callback rate.
   */
  onIncomingSample?: (sample: LocationSample, acceptedAtMs: number) => void;
}

/** Coalesce passive outbox flushes; force-sync bypasses this delay. */
const OUTBOX_FLUSH_DELAY_MS = 20_000;

function isUsableLocationSample(sample: LocationSample): boolean {
  const coordinates = sample.coordinates;
  if (!coordinates) return false;
  const { latitude, longitude } = coordinates;
  return Number.isFinite(sample.timestamp)
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180;
}

export type ForegroundSampleOptions = {
  /** Important target/arrival consumers may request an immediate UI projection. */
  immediate?: boolean;
};

export function useDeviceLocation({
  groupId,
  highAccuracy,
  nativeMapLocationEnabled = false,
  sharingEnabled = true,
  hasMembership,
  teamNavigationActive = false,
  onIncomingSample,
}: UseDeviceLocationParams) {
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);
  const [deviceAccuracyM, setDeviceAccuracyM] = useState<number | null>(null);
  /** Wall-clock of last UI-accepted sample — drives progress freshness/stale. */
  const [deviceCoordsAcceptedAtMs, setDeviceCoordsAcceptedAtMs] = useState<number | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const lastSampleAtRef = useRef(0);
  const latestSampleRef = useRef<LocationSample | null>(null);
  const onIncomingSampleRef = useRef(onIncomingSample);
  onIncomingSampleRef.current = onIncomingSample;
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
  // Precision is an explicit user switch. Team navigation selects the journey
  // power profile but must not silently promote upload/GPS precision.
  highAccuracyRef.current = highAccuracy;
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

  const policyNow = () => locationPolicy(
    highAccuracyRef.current,
    // The precise switch is sufficient to opt into the high-frequency journey
    // profile; team navigation is only an independent reason to use journey
    // cadence, never an implicit precision switch.
    highAccuracyRef.current || teamNavigationRef.current ? 'journey' : 'foreground',
  );

  const scheduleOutboxFlush = useCallback(() => {
    if (outboxFlushTimerRef.current) return;
    outboxFlushTimerRef.current = setTimeout(() => {
      outboxFlushTimerRef.current = null;
      void flushLocationOutbox().catch(() => undefined);
    }, OUTBOX_FLUSH_DELAY_MS);
  }, []);

  const acceptIncomingSample = useCallback((sample: LocationSample, now: number): boolean => {
    if (!groupIdRef.current || !sharingEnabledRef.current || !hasMembershipRef.current
      || AppState.currentState !== 'active' || !isUsableLocationSample(sample)
      || sample.timestamp <= lastSampleAtRef.current) return false;
    lastSampleAtRef.current = sample.timestamp;
    latestSampleRef.current = sample;
    try {
      onIncomingSampleRef.current?.(sample, Math.min(now, sample.timestamp));
    } catch {
      // An arrival/target observer is advisory; it must not stop GPS uploads.
    }
    return true;
  }, []);

  const applySampleToUi = useCallback((
    sample: LocationSample,
    now: number,
    options: ForegroundSampleOptions = {},
  ) => {
    const coords = sample.coordinates;
    if (!groupIdRef.current || !sharingEnabledRef.current || !hasMembershipRef.current
      || AppState.currentState !== 'active' || !isUsableLocationSample(sample)) return false;
    if (!options.immediate && !shouldAcceptUiSample(coords, now, uiGateRef.current, policyNow())) {
      return false;
    }
    setDeviceCoords(coords);
    deviceCoordsRef.current = coords;
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
      requestedGroup = groupIdRef.current,
    ): Promise<void> => {
      const gid = requestedGroup;
      if (!gid || !sharingEnabledRef.current || !hasMembershipRef.current) return;
      const access = await captureLocationAccess(gid);
      if (!access) return;
      if (gid !== groupIdRef.current || !sharingEnabledRef.current || !hasMembershipRef.current) return;
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
      if (!isLocationAccessCurrent(access) || gid !== groupIdRef.current) return;
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
   * Apply one foreground sample (MapKit or Expo watch). Raw fixes are kept
   * separate from the throttled React projection so arrival stays accurate
   * without making the map render at callback frequency.
   * Never calls getCurrentLocation — caller owns the sample source.
   */
  const consumeForegroundSample = useCallback(
    (sample: LocationSample, options: ForegroundSampleOptions = {}): void => {
      energyObservability.increment('location_callback');
      const now = Date.now();
      if (!acceptIncomingSample(sample, now)) return;
      const policy = policyNow();
      const coords = sample.coordinates;
      motionRef.current = reduceMotionState(motionRef.current, coords, now, policy, sample.accuracy ?? 0);
      applySampleToUi(sample, now, options);

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
        // Reserve the gate before the async SQLite serial queue starts. GPS
        // callbacks can arrive faster than persistence; without this
        // reservation they would all pass the same stale gate.
        uploadGateRef.current = { lastCoords: coords, lastAtMs: now };
        const requestedGroup = groupIdRef.current;
        void enqueueUpload(
          sample,
          now,
          { immediate: teamNavigationRef.current },
          requestedGroup,
        ).catch(() => undefined);
      }
    },
    [acceptIncomingSample, applySampleToUi, enqueueUpload],
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
    const fix = await location.getCurrentLocation(
      highAccuracyRef.current,
      highAccuracyRef.current || teamNavigationRef.current ? 'journey' : 'foreground',
    );
    if (!fix || !isLocationAccessCurrent(access) || !sharingEnabledRef.current || requestedGroup !== groupIdRef.current || !groupIdRef.current || !hasMembershipRef.current || AppState.currentState !== 'active') return null;
    const now = Date.now();
    if (!acceptIncomingSample(fix, now)) return deviceCoordsRef.current;
    energyObservability.increment('location_accepted');
    energyObservability.event('location_acquisition');
    applySampleToUi(fix, now, { immediate: true });
    motionRef.current = reduceMotionState(
      motionRef.current,
      fix.coordinates,
      now,
      policyNow(),
      fix.accuracy ?? 0,
    );
    if (groupIdRef.current && sharingEnabledRef.current && hasMembershipRef.current) {
      uploadGateRef.current = { lastCoords: fix.coordinates, lastAtMs: now };
      if (options?.requireUpload) {
        await enqueueUpload(fix, now, { immediate: true }, requestedGroup);
      } else {
        await enqueueUpload(fix, now, { immediate: true }, requestedGroup).catch(() => undefined);
      }
    }
    return fix.coordinates;
  }, [acceptIncomingSample, applySampleToUi, enqueueUpload]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  // Reset gates when profile changes so the next sample is accepted immediately.
  useEffect(() => {
    uiGateRef.current = { lastCoords: null, lastAtMs: 0 };
    uploadGateRef.current = { lastCoords: null, lastAtMs: 0 };
    lastSampleAtRef.current = 0;
    latestSampleRef.current = null;
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
      applySampleToUi(sample, now, { immediate: true });
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
      }, highAccuracy, highAccuracy || teamNavigationActive ? 'journey' : 'foreground')
      .then((unsub: () => void) => {
        if (cancelled) unsub();
        else stop = unsub;
      })
      .catch(() => undefined);
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
    /** Raw latest fix for imperative coordinator wiring; does not trigger renders. */
    latestLocationSampleRef: latestSampleRef,
  };
}
