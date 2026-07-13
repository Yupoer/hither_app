import { useState, useCallback, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { location } from '../../../native';
import { updateMyLocation } from '../../../api/client';
import type { Coordinates } from '../../../types';
import { shouldWatchLocation } from '../../../utils/locationPolicy';

interface UseDeviceLocationParams {
  groupId: string | null | undefined;
  highAccuracy: boolean;
}

export function useDeviceLocation({ groupId, highAccuracy }: UseDeviceLocationParams) {
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  const refreshDeviceLocation = useCallback(async (): Promise<Coordinates | null> => {
    const fix = await location.getCurrentLocation(highAccuracy);
    if (fix) {
      setDeviceCoords(fix.coordinates);
      if (groupId) await updateMyLocation(fix.coordinates, groupId);
      return fix.coordinates;
    }
    return null;
  }, [groupId, highAccuracy]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!shouldWatchLocation(groupId ?? null, appState)) return;
    let cancelled = false;
    let stop = () => {};
    void location
      .watchLocation((sample: { coordinates: Coordinates }) => {
        setDeviceCoords(sample.coordinates);
        void updateMyLocation(sample.coordinates, groupId!).catch(() => {});
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
    refreshDeviceLocation,
  };
}
