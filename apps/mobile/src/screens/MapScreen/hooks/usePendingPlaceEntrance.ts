import { createElement, Fragment, useRef, useState } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
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
  const pendingPlaceMotionLifecycle = createElement(PendingPlaceMotion, { visible, progress, sheetHeight, pendingPlace, shownPlace, setReady });
  return {
    lifecycle: createElement(Fragment, { key: 'pending-place-entrance-runtime' }, pendingPlaceMotionLifecycle), ready: ready && pendingPlace != null, progress };
}

function PendingPlaceMotion({ visible, progress, sheetHeight, pendingPlace, shownPlace, setReady }: {
  visible: boolean;
  progress: SharedValue<number>;
  sheetHeight: SharedValue<number>;
  pendingPlace: PlaceResult | null;
  shownPlace: import("react").RefObject<PlaceResult | null>;
  setReady: import("react").Dispatch<import("react").SetStateAction<boolean>>;
}) {
  const [pendingPlaceMotionInputs, setPendingPlaceMotionInputs] = useState(() => ({ generation: 0, pendingPlace, progress, sheetHeight, visible }));
  if (!(Object.is(pendingPlaceMotionInputs.pendingPlace, pendingPlace) && Object.is(pendingPlaceMotionInputs.progress, progress) && Object.is(pendingPlaceMotionInputs.sheetHeight, sheetHeight) && Object.is(pendingPlaceMotionInputs.visible, visible))) {
    setPendingPlaceMotionInputs({ generation: pendingPlaceMotionInputs.generation + 1, pendingPlace, progress, sheetHeight, visible });
  }
  return createElement(PendingPlaceMotionCommit, { key: pendingPlaceMotionInputs.generation, visible, progress, sheetHeight, pendingPlace, shownPlace, setReady });
}

function PendingPlaceMotionCommit({ visible, progress, sheetHeight, pendingPlace, shownPlace, setReady }: {
  visible: boolean;
  progress: SharedValue<number>;
  sheetHeight: SharedValue<number>;
  pendingPlace: PlaceResult | null;
  shownPlace: import("react").RefObject<PlaceResult | null>;
  setReady: import("react").Dispatch<import("react").SetStateAction<boolean>>;
}) {
  useMountEffect(() => {
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
  });
  return null;
}
