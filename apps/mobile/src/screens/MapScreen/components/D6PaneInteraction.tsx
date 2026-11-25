import { createContext, useContext, useState, type ReactNode } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
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
  reportContent?: Panel['onContentHeight'];
} | null>(null);

export function D6PaneOverlay({ children }: { children: ReactNode }) {
  const panel = useContext(D6PaneInteractionContext);
  const setOverlay = panel?.setOverlay;
  const [previous, setPrevious] = useState({ children, setOverlay, generation: 0 });
  if (previous.children !== children || previous.setOverlay !== setOverlay) {
    setPrevious({ children, setOverlay, generation: previous.generation + 1 });
  }
  return panel
    ? <D6PaneOverlayResource key={previous.generation} publish={panel.setOverlay}>{children}</D6PaneOverlayResource>
    : children;
}

function D6PaneOverlayResource({ publish, children }: {
  publish: (node: ReactNode) => void;
  children: ReactNode;
}) {
  useMountEffect(() => {
    publish(children);
    return () => publish(null);
  });
  return null;
}
