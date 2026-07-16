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
  locationPolicy,
  shouldAcceptUiSample,
  shouldUploadSample,
  shouldWatchLocation,
  type LocationGateState,
} from '../../../utils/locationPolicy';

interface UseDeviceLocationParams {
  groupId: string | null | undefined;
  highAccuracy: boolean;
}

export function useDeviceLocation({ groupId, highAccuracy }: UseDeviceLocationParams) {
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);
  const [deviceAccuracyM, setDeviceAccuracyM] = useState<number | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const uiGateRef = useRef<LocationGateState>({ lastCoords: null, lastAtMs: 0 });
  const uploadGateRef = useRef<LocationGateState>({ lastCoords: null, lastAtMs: 0 });

  const refreshDeviceLocation = useCallback(async (): Promise<Coordinates | null> => {
    // Manual refresh bypasses gates — force one-shot fix + upload.
    const fix = await location.getCurrentLocation(highAccuracy);
    if (fix) {
      const now = Date.now();
      setDeviceCoords(fix.coordinates);
      setDeviceAccuracyM(
        fix.accuracy != null && Number.isFinite(fix.accuracy) ? fix.accuracy : null,
      );
      uiGateRef.current = { lastCoords: fix.coordinates, lastAtMs: now };
      if (groupId) {
        await enqueueLocationOutbox({
          groupId,
          coordinates: fix.coordinates,
          capturedAt: fix.timestamp,
        });
        await flushLocationOutbox();
        uploadGateRef.current = { lastCoords: fix.coordinates, lastAtMs: now };
      }
      return fix.coordinates;
    }
    return null;
  }, [groupId, highAccuracy]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  // Reset gates when profile changes so the next sample is accepted immediately.
  useEffect(() => {
    uiGateRef.current = { lastCoords: null, lastAtMs: 0 };
    uploadGateRef.current = { lastCoords: null, lastAtMs: 0 };
  }, [highAccuracy]);

  useEffect(() => {
    if (groupId && appState === 'active') {
      void flushLocationOutbox().catch(() => undefined);
    }
  }, [appState, groupId]);

  useEffect(() => {
    if (!shouldWatchLocation(groupId ?? null, appState)) return;
    let cancelled = false;
    let stop = () => {};
    const policy = locationPolicy(highAccuracy);
    void location
      .watchLocation((sample: LocationSample) => {
        const now = Date.now();
        const coords = sample.coordinates;

        if (shouldAcceptUiSample(coords, now, uiGateRef.current, policy)) {
          uiGateRef.current = { lastCoords: coords, lastAtMs: now };
          setDeviceCoords(coords);
          setDeviceAccuracyM(
            sample.accuracy != null && Number.isFinite(sample.accuracy)
              ? sample.accuracy
              : null,
          );
        }

        if (
          groupId &&
          shouldUploadSample(coords, now, uploadGateRef.current, policy)
        ) {
          void enqueueLocationOutbox({
            groupId,
            coordinates: coords,
            capturedAt: sample.timestamp,
          })
            .then(() => flushLocationOutbox())
            .then(() => {
              uploadGateRef.current = { lastCoords: coords, lastAtMs: now };
            })
            .catch(() => undefined);
        }
      }, highAccuracy)
      .then((unsub: () => void) => {
        if (cancelled) unsub();
        else stop = unsub;
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [appState, groupId, highAccuracy]);

  return {
    deviceCoords,
    /** Horizontal accuracy of the last accepted device fix, metres. */
    deviceAccuracyM,
    /** Exposed so MapScreen can own a single GPS path (FG watch vs BG task). */
    appState,
    refreshDeviceLocation,
  };
}
