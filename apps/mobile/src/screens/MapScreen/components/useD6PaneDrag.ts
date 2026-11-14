import { createElement, useCallback, useMemo, useState } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useVisibleUi } from '../../../state/foregroundUi';
import { nativeD6PaneAvailable } from '../../../native/d6Pane';
import { Gesture } from 'react-native-gesture-handler';
import type { ScrollView } from 'react-native';
import { cancelAnimation, dispatchCommand, runOnJS, runOnUI, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

type Detent = 'closed' | 'half' | 'full';
type ContentDrag = { kind: 'idle' }
  | { kind: 'native'; translation: number }
  | { kind: 'controlled'; translation: number; offset: number };

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
  const target = useSharedValue<Detent>(open ? 'half' : 'closed');
  const requested = useSharedValue(open);
  const height = useSharedValue(open ? half : closed);
  const origin = useSharedValue(closed);
  const dragging = useSharedValue(false);
  const scrollRef = useAnimatedRef<ScrollView>();
  const scrollOffset = useSharedValue(0);
  const scrollContent = useSharedValue(0);
  const scrollViewport = useSharedValue(0);
  const contentDrag = useSharedValue<ContentDrag>({ kind: 'idle' });
  const scrollGesture = useMemo(() => Gesture.Native().disallowInterruption(false), []);
  const scrollHandler = useAnimatedScrollHandler(event => {
    scrollContent.set(event.contentSize.height);
    scrollViewport.set(event.layoutMeasurement.height);
    const content = contentDrag.get();
    if (content.kind === 'controlled') {
      if (Math.abs(event.contentOffset.y - content.offset) > 0.5) {
        scrollTo(scrollRef, 0, content.offset, false);
      }
    } else {
      scrollOffset.set(event.contentOffset.y);
    }
  });
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

  const animateTo = useCallback((next: Detent, velocity = 0) => {
    const nextHeight = next === 'closed' ? closed : next === 'half' ? half : full;
    if (reduceMotion || !visible) {
      cancelAnimation(height);
      height.set(nextHeight);
      setPreview(false);
    } else {
      height.set(withSpring(nextHeight, {
        damping: 29, stiffness: 285, mass: 0.8, velocity, overshootClamping: true,
      }, finished => {
        if (finished && next === 'closed') runOnJS(finishClosing)();
      }));
      if (next !== 'closed') setPreview(false);
    }
  }, [closed, half, full, height, reduceMotion, visible, finishClosing]);

  const sync = () => {
    let next = target.get();
    if (requested.get() !== open) {
      requested.set(open);
      next = open ? 'half' : 'closed';
      target.set(next);
      setDetent(next);
      if (!open) setPreview(true);
    }
    contentDrag.set({ kind: 'idle' });
    dragging.set(false);
    animateTo(next);
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
    setPreview(true);
    onDragBegin();
  }, [onDragBegin]);
  const restore = useCallback(() => animateTo(target.get()), [animateTo, target]);
  const contentGesture = useMemo(() => Gesture.Pan()
    .enabled(visible)
    .activeOffsetY([-6, 6])
    .failOffsetX([-16, 16])
    .simultaneousWithExternalGesture(scrollGesture)
    .onStart(() => {
      contentDrag.set({ kind: 'native', translation: 0 });
    })
    .onUpdate(({ translationY }) => {
      const content = contentDrag.get();
      if (content.kind === 'idle') return;
      const delta = translationY - content.translation;
      const maximumOffset = Math.max(0, scrollContent.get() - scrollViewport.get()
        + (nativeD6PaneAvailable ? full - height.get() : 0));
      if (content.kind === 'native') {
        contentDrag.set({ kind: 'native', translation: translationY });
        const atEdge = direction === -1 ? scrollOffset.get() <= 2 : scrollOffset.get() >= maximumOffset - 2;
        const expanding = direction * delta > 0;
        if (delta === 0 || (expanding ? height.get() >= full - 0.5 : !atEdge)) return;
        cancelAnimation(height);
        const offset = Math.max(0, Math.min(maximumOffset, scrollOffset.get()));
        contentDrag.set({ kind: 'controlled', translation: translationY, offset });
        scrollOffset.set(offset);
        dragging.set(true);
        scrollTo(scrollRef, 0, offset, false);
        runOnJS(begin)();
        return;
      }
      let nextHeight = height.get();
      let offset = content.offset;
      let remaining = delta;
      if (nextHeight < full) {
        const resized = Math.max(closed, Math.min(full, nextHeight + direction * remaining));
        remaining -= direction * (resized - nextHeight);
        nextHeight = resized;
      }
      const nextMaximum = Math.max(0, scrollContent.get() - scrollViewport.get()
        + (nativeD6PaneAvailable ? full - nextHeight : 0));
      offset = Math.max(0, Math.min(nextMaximum, offset));
      if (nextHeight === full) {
        const scrolled = Math.max(0, Math.min(nextMaximum, offset - remaining));
        remaining += scrolled - offset;
        offset = scrolled;
        if (direction * remaining < 0) {
          nextHeight = Math.max(closed, full + direction * remaining);
        }
      }
      contentDrag.set({ kind: 'controlled', translation: translationY, offset });
      scrollOffset.set(offset);
      height.set(nextHeight);
      scrollTo(scrollRef, 0, offset, false);
    })
    .onEnd(({ velocityY }, success) => {
      if (contentDrag.get().kind !== 'controlled' || !success) return;
      dragging.set(false);
      contentDrag.set({ kind: 'idle' });
      const speed = direction * velocityY;
      const projected = height.get() + Math.max(-64, Math.min(64, speed * 0.12));
      const next: Detent = projected <= (closed + half) / 2 ? 'closed'
        : projected <= (half + full) / 2 ? 'half' : 'full';
      runOnJS(snapTo)(next, speed);
    })
    .onFinalize(() => {
      const controlled = contentDrag.get().kind === 'controlled';
      contentDrag.set({ kind: 'idle' });
      if (!controlled) return;
      dragging.set(false);
      runOnJS(restore)();
    }), [visible, scrollGesture, scrollContent, scrollViewport, scrollOffset, scrollRef,
    contentDrag, closed, full, half, height, dragging, direction, begin, snapTo, restore]);
  const gesture = useMemo(() => Gesture.Pan()
    .enabled(visible)
    .activeOffsetY([-6, 6])
    .failOffsetX([-16, 16])
    .onStart(() => {
      contentDrag.set({ kind: 'idle' });
      dragging.set(true);
      cancelAnimation(height);
      origin.set(height.get());
      runOnJS(begin)();
    })
    .onUpdate(({ translationY }) => {
      if (!dragging.get()) return;
      height.set(Math.max(closed, Math.min(full, origin.get() + direction * translationY)));
    })
    .onEnd(({ translationY, velocityY }, success) => {
      if (!success || !dragging.get()) return;
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
    }), [visible, begin, closed, contentDrag, direction, dragging, full, half, height, origin, restore, snapTo]);

  return { detent, preview, height, animatedStyle, nativeRef, contentDidLayout, gesture, snapTo, lifecycle,
    contentGesture, scrollGesture, scrollRef, scrollHandler, scrollContent, scrollViewport,
    layoutHeight: nativeD6PaneAvailable ? full : closed, closed, full };
}

function SyncPaneHeight({ sync }: { sync: () => void }) {
  useMountEffect(sync);
  return null;
}
