import { useState, useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { location } from '../../../native';
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
  uploadHeartbeatForCadence,
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
}

/** Coalesce passive outbox flushes; force-sync bypasses this delay. */
const OUTBOX_FLUSH_DELAY_MS = 5_000;
/** Independent timer tick — picks the active motion heartbeat each fire. */
const HEARTBEAT_TICK_MS = 15_000;

export function useDeviceLocation({
  groupId,
  highAccuracy,
  nativeMapLocationEnabled = false,
}: UseDeviceLocationParams) {
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);
  const [deviceAccuracyM, setDeviceAccuracyM] = useState<number | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const uiGateRef = useRef<LocationGateState>({ lastCoords: null, lastAtMs: 0 });
  const uploadGateRef = useRef<LocationGateState>({ lastCoords: null, lastAtMs: 0 });
  const motionRef = useRef<MotionState>(createMotionState());
  const outboxFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forceSyncInFlightRef = useRef(false);
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;
  const highAccuracyRef = useRef(highAccuracy);
  highAccuracyRef.current = highAccuracy;
  const deviceCoordsRef = useRef(deviceCoords);
  deviceCoordsRef.current = deviceCoords;
  const deviceAccuracyRef = useRef(deviceAccuracyM);
  deviceAccuracyRef.current = deviceAccuracyM;
  const nativeMapLocationEnabledRef = useRef(nativeMapLocationEnabled);
  nativeMapLocationEnabledRef.current = nativeMapLocationEnabled;

  const scheduleOutboxFlush = useCallback(() => {
    if (outboxFlushTimerRef.current) return;
    outboxFlushTimerRef.current = setTimeout(() => {
      outboxFlushTimerRef.current = null;
      void flushLocationOutbox().catch(() => undefined);
    }, OUTBOX_FLUSH_DELAY_MS);
  }, []);

  const applySampleToUi = useCallback((sample: LocationSample, now: number) => {
    const coords = sample.coordinates;
    setDeviceCoords(coords);
    setDeviceAccuracyM(
      sample.accuracy != null && Number.isFinite(sample.accuracy) ? sample.accuracy : null,
    );
    uiGateRef.current = { lastCoords: coords, lastAtMs: now };
  }, []);

  const enqueueUpload = useCallback(
    async (
      sample: LocationSample,
      now: number,
      options: { immediate: boolean },
    ): Promise<void> => {
      const gid = groupIdRef.current;
      if (!gid) return;
      await enqueueLocationOutbox({
        groupId: gid,
        coordinates: sample.coordinates,
        capturedAt: sample.timestamp,
      });
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
      const now = Date.now();
      const policy = locationPolicy(highAccuracyRef.current);
      const coords = sample.coordinates;
      motionRef.current = reduceMotionState(motionRef.current, coords, now, policy);

      if (shouldAcceptUiSample(coords, now, uiGateRef.current, policy)) {
        applySampleToUi(sample, now);
      }

      if (
        groupIdRef.current &&
        shouldUploadSample(
          coords,
          now,
          uploadGateRef.current,
          policy,
          motionRef.current.cadence,
        )
      ) {
        void enqueueUpload(sample, now, { immediate: false }).catch(() => undefined);
      }
    },
    [applySampleToUi, enqueueUpload],
  );

  /**
   * Force one-shot GPS + immediate upload (manual refresh / foreground resume).
   * Bypasses distance/time gates — "force sync".
   */
  const refreshDeviceLocation = useCallback(async (): Promise<Coordinates | null> => {
    const fix = await location.getCurrentLocation(highAccuracyRef.current);
    if (!fix) return null;
    const now = Date.now();
    applySampleToUi(fix, now);
    motionRef.current = reduceMotionState(
      motionRef.current,
      fix.coordinates,
      now,
      locationPolicy(highAccuracyRef.current),
    );
    if (groupIdRef.current) {
      await enqueueUpload(fix, now, { immediate: true }).catch(() => undefined);
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
  }, [highAccuracy]);

  // Foreground force-sync: open app / return from background → upload now.
  useEffect(() => {
    if (!groupId || appState !== 'active') return;
    if (forceSyncInFlightRef.current) return;
    forceSyncInFlightRef.current = true;
    void refreshDeviceLocation()
      .catch(() => null)
      .finally(() => {
        forceSyncInFlightRef.current = false;
      });
  }, [appState, groupId, refreshDeviceLocation]);

  useEffect(() => {
    if (groupId && appState === 'active') {
      void flushLocationOutbox().catch(() => undefined);
    }
  }, [appState, groupId]);

  // Independent heartbeat timer — does not rely on iOS watch callbacks while still.
  useEffect(() => {
    if (!shouldWatchLocation(groupId ?? null, appState)) return;

    const tick = () => {
      const gid = groupIdRef.current;
      if (!gid || AppState.currentState !== 'active') return;
      const policy = locationPolicy(highAccuracyRef.current);
      const now = Date.now();
      // Quiet without GPS callbacks: still age into stationary.
      if (
        motionRef.current.lastCoords &&
        now - motionRef.current.lastSignificantMoveAtMs >= policy.stationaryAfterMs
      ) {
        motionRef.current = {
          ...motionRef.current,
          cadence: 'stationary',
        };
      }
      const heartbeatMs = uploadHeartbeatForCadence(
        policy,
        motionRef.current.cadence,
      );
      const lastUploadAt = uploadGateRef.current.lastAtMs;
      if (lastUploadAt > 0 && now - lastUploadAt < heartbeatMs) return;

      const lastKnown = deviceCoordsRef.current ?? uploadGateRef.current.lastCoords;
      const cadenceNow = motionRef.current.cadence;
      void (async () => {
        let sample: LocationSample | null = null;
        if (cadenceNow === 'stationary' && lastKnown && lastUploadAt > 0) {
          // Stationary liveness: reuse last known to avoid extra GPS wake.
          sample = {
            coordinates: lastKnown,
            accuracy: deviceAccuracyRef.current,
            timestamp: now,
          };
        } else if (nativeMapLocationEnabledRef.current && lastKnown) {
          // MapKit owns continuous GPS; heartbeat only reuses last known.
          sample = {
            coordinates: lastKnown,
            accuracy: deviceAccuracyRef.current,
            timestamp: now,
          };
        } else {
          sample = await location.getCurrentLocation(highAccuracyRef.current).catch(() => null);
          if (!sample && lastKnown) {
            sample = {
              coordinates: lastKnown,
              accuracy: deviceAccuracyRef.current,
              timestamp: now,
            };
          }
        }
        if (!sample) return;
        const sampleNow = Date.now();
        motionRef.current = reduceMotionState(
          motionRef.current,
          sample.coordinates,
          sampleNow,
          policy,
        );
        if (
          shouldUploadSample(
            sample.coordinates,
            sampleNow,
            uploadGateRef.current,
            policy,
            motionRef.current.cadence,
          )
        ) {
          if (shouldAcceptUiSample(sample.coordinates, sampleNow, uiGateRef.current, policy)) {
            applySampleToUi(sample, sampleNow);
          }
          await enqueueUpload(sample, sampleNow, { immediate: true }).catch(() => undefined);
        }
      })();
    };

    const timer = setInterval(tick, HEARTBEAT_TICK_MS);
    return () => clearInterval(timer);
  }, [appState, groupId, applySampleToUi, enqueueUpload]);

  // Expo watch is fallback only when MapKit is not the foreground owner.
  useEffect(() => {
    if (nativeMapLocationEnabled) return;
    if (!shouldWatchLocation(groupId ?? null, appState)) return;
    let cancelled = false;
    let stop = () => {};
    void location
      .watchLocation((sample: LocationSample) => {
        consumeForegroundSample(sample);
      }, highAccuracy)
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
  }, [appState, groupId, highAccuracy, nativeMapLocationEnabled, consumeForegroundSample]);

  return {
    deviceCoords,
    /** Horizontal accuracy of the last accepted device fix, metres. */
    deviceAccuracyM,
    /** Exposed so MapScreen can own a single GPS path (FG watch vs BG task). */
    appState,
    refreshDeviceLocation,
    consumeForegroundSample,
  };
}
