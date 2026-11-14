import { createElement, useCallback, useMemo, useState } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useVisibleUi } from '../../../state/foregroundUi';
import { nativeD6PaneAvailable } from '../../../native/d6Pane';
import { Gesture } from 'react-native-gesture-handler';
import { cancelAnimation, dispatchCommand, runOnJS, runOnUI, useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

type Detent = 'closed' | 'half' | 'full';

export function useD6PaneDrag({
  closed, full, direction, open, reduceMotion, onOpenChange, onDragBegin,
}: {
  closed: number;
  full: number;
  direction: 1 | -1;
  open: boolean;
  reduceMotion: boolean;
  onOpenChange: (open: boolean) => void;
  onDragBegin: () => void;
}) {
  const visible = useVisibleUi();
  const half = closed + (full - closed) * 0.48;
  const [detent, setDetent] = useState<Detent>(open ? 'half' : 'closed');
  const [preview, setPreview] = useState(false);
  const [layoutHeight, setLayoutHeight] = useState(full);
  const target = useSharedValue<Detent>(open ? 'half' : 'closed');
  const requested = useSharedValue(open);
  const height = useSharedValue(open ? half : closed);
  const origin = useSharedValue(closed);
  const dragging = useSharedValue(false);
  const nativeRef = useAnimatedRef();
  const animatedStyle = useAnimatedStyle(() => nativeD6PaneAvailable ? {} : ({ height: height.value }));
  useAnimatedReaction(
    () => nativeD6PaneAvailable && nativeRef() ? height.get() : null,
    value => { if (value !== null) dispatchCommand(nativeRef, 'setPanelHeight', [value]); },
  );
  const contentDidLayout = useCallback(() => {
    if (!nativeD6PaneAvailable) return;
    runOnUI(() => { if (nativeRef()) dispatchCommand(nativeRef, 'contentDidLayout', []); })();
  }, [nativeRef]);
  const finishClosing = useCallback(() => {
    if (target.get() === 'closed' && !dragging.get()) setPreview(false);
  }, [dragging, target]);
  const finishLayout = useCallback((next: Detent, nextHeight: number) => {
    if (target.get() === next && !dragging.get()) setLayoutHeight(nextHeight);
  }, [dragging, target]);

  const animateTo = useCallback((next: Detent, velocity = 0) => {
    const nextHeight = next === 'closed' ? closed : next === 'half' ? half : full;
    if (nativeD6PaneAvailable && !reduceMotion && visible) setLayoutHeight(full);
    if (reduceMotion || !visible) {
      cancelAnimation(height);
      if (nativeD6PaneAvailable) setLayoutHeight(nextHeight);
      height.set(nextHeight);
      setPreview(false);
    } else {
      height.set(withSpring(nextHeight, {
        damping: 29, stiffness: 285, mass: 0.8, velocity, overshootClamping: true,
      }, finished => {
        if (finished && next === 'closed') runOnJS(finishClosing)();
        if (finished && next !== 'closed' && nativeD6PaneAvailable) runOnJS(finishLayout)(next, nextHeight);
      }));
      if (next !== 'closed') setPreview(false);
    }
  }, [closed, half, full, height, reduceMotion, visible, finishClosing, finishLayout]);

  const sync = () => {
    let next = target.get();
    if (requested.get() !== open) {
      requested.set(open);
      next = open ? 'half' : 'closed';
      target.set(next);
      setDetent(next);
      if (!open) setPreview(true);
    }
    if (!visible) dragging.set(false);
    if (!dragging.get()) animateTo(next);
  };
  const lifecycle = createElement(SyncPaneHeight, {
    key: `${open}:${closed}:${full}:${reduceMotion}:${visible}`, sync,
  });

  const snapTo = useCallback((next: Detent, velocity = 0) => {
    const nextOpen = next !== 'closed';
    if (!nextOpen && requested.get()) setPreview(true);
    target.set(next);
    setDetent(next);
    animateTo(next, velocity);
    if (nextOpen !== requested.get()) {
      requested.set(nextOpen);
      onOpenChange(nextOpen);
    }
  }, [animateTo, onOpenChange, requested, target]);
  const begin = useCallback(() => {
    if (nativeD6PaneAvailable) setLayoutHeight(full);
    setPreview(true);
    onDragBegin();
  }, [full, onDragBegin]);
  const restore = useCallback(() => animateTo(target.get()), [animateTo, target]);
  const gesture = useMemo(() => Gesture.Pan()
    .activeOffsetY([-6, 6])
    .failOffsetX([-16, 16])
    .onStart(() => {
      dragging.set(true);
      cancelAnimation(height);
      origin.set(height.get());
      runOnJS(begin)();
    })
    .onUpdate(({ translationY }) => {
      height.set(Math.max(closed, Math.min(full, origin.get() + direction * translationY)));
    })
    .onEnd(({ translationY, velocityY }, success) => {
      if (!success) return;
      dragging.set(false);
      const speed = direction * velocityY;
      const projection = Math.max(-64, Math.min(64, speed * 0.12));
      const released = Math.max(closed, Math.min(full, origin.get() + direction * translationY));
      const projected = released + projection;
      const next: Detent = projected <= (closed + half) / 2 ? 'closed'
        : projected <= (half + full) / 2 ? 'half' : 'full';
      runOnJS(snapTo)(next, speed);
    })
    .onFinalize(() => {
      if (!dragging.get()) return;
      dragging.set(false);
      runOnJS(restore)();
    }), [begin, closed, direction, dragging, full, half, height, origin, restore, snapTo]);

  return { detent, preview, height, animatedStyle, nativeRef, contentDidLayout, gesture, snapTo, lifecycle,
    layoutHeight: nativeD6PaneAvailable ? layoutHeight : closed, closed, full };
}

function SyncPaneHeight({ sync }: { sync: () => void }) {
  useMountEffect(sync);
  return null;
}
