import { useState, useCallback, useEffect } from 'react';
import { location } from '../../../native';
import { updateMyLocation } from '../../../api/client';
import type { Coordinates } from '../../../types';

interface UseDeviceLocationParams {
  groupId: string | null | undefined;
  powerSaver: boolean;
}

export function useDeviceLocation({ groupId, powerSaver }: UseDeviceLocationParams) {
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);

  const refreshDeviceLocation = useCallback(async (): Promise<Coordinates | null> => {
    const fix = await location.getCurrentLocation();
    if (fix) {
      setDeviceCoords(fix.coordinates);
      if (groupId) void updateMyLocation(fix.coordinates, groupId);
      return fix.coordinates;
    }
    return null;
  }, [groupId]);

  useEffect(() => {
    void refreshDeviceLocation();
  }, [refreshDeviceLocation]);

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    let stop = () => {};
    void location
      .watchLocation((sample: { coordinates: Coordinates }) => {
        setDeviceCoords(sample.coordinates);
        void updateMyLocation(sample.coordinates, groupId);
      }, powerSaver)
      .then((unsub: () => void) => {
        if (cancelled) unsub();
        else stop = unsub;
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [groupId, powerSaver]);

  return {
    deviceCoords,
    refreshDeviceLocation,
  };
}
