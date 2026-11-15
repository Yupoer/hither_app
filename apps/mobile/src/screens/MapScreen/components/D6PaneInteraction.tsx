import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import type { View } from 'react-native';
import type { AnimatedRef } from 'react-native-reanimated';
import type { useD6PaneDrag } from './useD6PaneDrag';

type Panel = ReturnType<typeof useD6PaneDrag>;
export const D6PaneInteractionContext = createContext<{
  owner: Panel['owner'];
  paneGesture: Panel['contentGesture'];
  scrollGesture: Panel['scrollGesture'];
  overlayRef: AnimatedRef<View>;
  viewport: { ref: AnimatedRef<View>; height: Panel['height']; closed: number };
  setOverlay: (node: ReactNode) => void;
  open: boolean;
} | null>(null);

export function D6PaneOverlay({ children }: { children: ReactNode }) {
  const panel = useContext(D6PaneInteractionContext);
  const setOverlay = panel?.setOverlay;
  useLayoutEffect(() => {
    setOverlay?.(children);
    return () => setOverlay?.(null);
  }, [children, setOverlay]);
  return panel ? null : children;
}
