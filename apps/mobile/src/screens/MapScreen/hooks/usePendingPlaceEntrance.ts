import { useEffect, useRef, useState } from 'react';
import { cancelAnimation, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import type { PlaceResult } from '../../../native';

/** Retain the selected place and final pose when its display is suspended. */
export function usePendingPlaceEntrance(
  pendingPlace: PlaceResult | null,
  visible: boolean,
  sheetHeight: SharedValue<number>,
) {
  const [ready, setReady] = useState(false);
  const progress = useSharedValue(0);
  const shownPlace = useRef<PlaceResult | null>(null);
  useEffect(() => {
    if (!visible) {
      cancelAnimation(progress);
      cancelAnimation(sheetHeight);
    }
    if (!pendingPlace) {
      shownPlace.current = null;
      setReady(false);
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    if (!visible) return;
    const timer = setTimeout(() => {
      setReady(true);
      if (shownPlace.current === pendingPlace) progress.value = 1;
      else {
        shownPlace.current = pendingPlace;
        progress.value = 0;
        progress.value = withSpring(1, { damping: 16, stiffness: 100, mass: 1 });
      }
    }, 0);
    return () => { clearTimeout(timer); cancelAnimation(progress); };
  }, [pendingPlace, progress, sheetHeight, visible]);
  return { ready: ready && pendingPlace != null, progress };
}
