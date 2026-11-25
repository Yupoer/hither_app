import { createElement, useCallback, useMemo, useState } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useVisibleUi } from '../../../state/foregroundUi';
import { nativeD6PaneAvailable } from '../../../native/d6Pane';
import { Gesture } from 'react-native-gesture-handler';
import type { ScrollView } from 'react-native';
import { cancelAnimation, dispatchCommand, runOnJS, runOnUI, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { claimD6Drag, releaseD6Drag, type D6DragOwner } from './d6DragOwnership';
import { guardGesture } from './d6GestureGuard';

export type Detent = 'closed' | 'half' | 'full';
/** Natural pane body height, split into fixed leading chrome and scrollable content. */
export type D6PaneContentPart = { leading?: number; content?: number | null };
const DETENT_ORDER = ['closed', 'half', 'full'] satisfies readonly Detent[];
const MAX_CONTENT_SNAP_TRAVEL = 12;
const MAX_CHROME_SNAP_TRAVEL = 8;
const PAN_ACTIVATION_TRAVEL = 4;
const PAN_HORIZONTAL_LIMIT = 8;
const SCROLL_EDGE_TOLERANCE = 1;
const DETENT_SNAP_FRACTION = 0.32;
const MIN_FLICK_TRAVEL = 5;
const MIN_FLICK_SPEED = 280;

function releaseDetent(
  target: Detent,
  origin: number,
  released: number,
  velocity: number,
  heights: Readonly<Record<Detent, number>>,
  maxSnapTravel: number,
): Detent {
  'worklet';
  const travel = released - origin;
  const direction = Math.sign(travel);
  if (direction === 0) return target;
  const distance = Math.abs(travel);
  const flick = distance >= MIN_FLICK_TRAVEL && direction * velocity >= MIN_FLICK_SPEED;
  let next = target;
  let index = DETENT_ORDER.indexOf(target);
  while (true) {
    const adjacent = DETENT_ORDER[index + direction];
    if (!adjacent) return next;
    const threshold = Math.min(maxSnapTravel, Math.abs(heights[adjacent] - heights[next]) * DETENT_SNAP_FRACTION);
    const crossed = distance >= threshold && direction * (released - heights[next]) >= threshold;
    if (!crossed) return next === target && flick ? adjacent : next;
    next = adjacent;
    index += direction;
  }
}
type ContentDrag = { kind: 'idle' }
  | { kind: 'native'; translation: number; offset: number }
  | { kind: 'controlled'; translation: number; offset: number };
type ChromeDrag = { kind: 'idle' }
  | { kind: 'tracking'; startY: number }
  | { kind: 'controlled'; activationTravel: number };

export function useD6PaneDrag({
  closed, full, openHeight, direction, open, reduceMotion, onOpenChange, onDragBegin,
  enabled = true, owner: sharedOwner, onContentHeight,
}: {
  closed: number;
  full: number;
  openHeight?: number;
  enabled?: boolean;
  direction: 1 | -1;
  open: boolean;
  reduceMotion: boolean;
  onOpenChange: (open: boolean) => void;
  onDragBegin: () => void;
  owner?: SharedValue<D6DragOwner>;
  onContentHeight?: (part: D6PaneContentPart) => void;
}) {
  const visible = useVisibleUi();
  const localOwner = useSharedValue<D6DragOwner>('idle');
  const owner = sharedOwner ?? localOwner;
  const pressCancelled = useSharedValue(false);
  const headerDrag = useSharedValue<ChromeDrag>({ kind: 'idle' });
  const footerDrag = useSharedValue<ChromeDrag>({ kind: 'idle' });
  const grabberDrag = useSharedValue<ChromeDrag>({ kind: 'idle' });
  const interactive = enabled && visible;
  const interactionEnabled = useSharedValue(interactive);
  const half = Math.max(closed, Math.min(full, openHeight ?? closed + (full - closed) * 0.48));
  const [detent, setDetent] = useState<Detent>(open ? 'half' : 'closed');
  const [preview, setPreview] = useState(false);
  const target = useSharedValue<Detent>(open ? 'half' : 'closed');
  const requested = useSharedValue(open);
  const height = useSharedValue(open ? half : closed);
  const detents = useSharedValue<Record<Detent, number>>({ closed, half, full });
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
    if (owner.get() === 'reorder') {
      scrollTo(scrollRef, 0, scrollOffset.get(), false);
    } else if (content.kind === 'controlled') {
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
  }, [dragging, target, setPreview]);

  const animateTo = useCallback((next: Detent, velocity = 0, heights: Record<Detent, number> = detents.get()) => {
    const nextHeight = heights[next];
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
  }, [detents, height, reduceMotion, visible, finishClosing, setPreview]);

  const sync = () => {
    const previous = detents.get();
    const boundsChanged = previous.closed !== closed || previous.full !== full;
    detents.set({ closed, half, full });
    interactionEnabled.set(interactive);
    let next = target.get();
    const openChanged = requested.get() !== open;
    if (openChanged) {
      requested.set(open);
      next = open ? 'half' : 'closed';
      target.set(next);
      setDetent(next);
      if (!open) setPreview(true);
    }
    if (!openChanged && !boundsChanged && interactive && dragging.get()) return;
    headerDrag.set({ kind: 'idle' });
    footerDrag.set({ kind: 'idle' });
    grabberDrag.set({ kind: 'idle' });
    if (dragging.get()) releaseD6Drag(owner, 'pane');
    contentDrag.set({ kind: 'idle' });
    dragging.set(false);
    animateTo(next, 0, { closed, half, full });
  };
  const lifecycle = createElement(SyncPaneHeight, {
    key: `${open}:${closed}:${half}:${full}:${reduceMotion}:${visible}:${enabled}`, sync,
  });

  const snapTo = useCallback((next: Detent, velocity = 0) => {
    if (!interactionEnabled.get()) return;
    const nextOpen = next !== 'closed';
    if (!nextOpen && requested.get()) setPreview(true);
    target.set(next);
    setDetent(next);
    animateTo(next, velocity);
    if (nextOpen !== requested.get()) {
      requested.set(nextOpen);
      onOpenChange(nextOpen);
    }
  }, [animateTo, interactionEnabled, onOpenChange, requested, target, setPreview, setDetent]);
  const begin = useCallback(() => {
    if (!interactionEnabled.get()) return;
    setPreview(true);
    onDragBegin();
  }, [interactionEnabled, onDragBegin, setPreview]);
  const restore = useCallback(() => animateTo(target.get()), [animateTo, target]);
  const resetContentDrag = useCallback(() => {
    'worklet';
    const controlled = contentDrag.get().kind === 'controlled';
    contentDrag.set({ kind: 'idle' });
    if (!controlled) return;
    dragging.set(false);
    releaseD6Drag(owner, 'pane');
    runOnJS(restore)();
  }, [contentDrag, dragging, owner, restore]);
  const contentGesture = useMemo(() => Gesture.Pan()
    .enabled(interactive)
    .activeOffsetY([-PAN_ACTIVATION_TRAVEL, PAN_ACTIVATION_TRAVEL])
    .failOffsetX([-PAN_HORIZONTAL_LIMIT, PAN_HORIZONTAL_LIMIT])
    .maxPointers(1)
    .simultaneousWithExternalGesture(scrollGesture)
    .onStart(guardGesture('pane-content-start', () => {
      'worklet';
      if (owner.get() !== 'idle') return;
      contentDrag.set({ kind: 'native', translation: 0, offset: scrollOffset.get() });
    }, resetContentDrag))
    .onUpdate(guardGesture('pane-content-update', ({ translationY }: { translationY: number }) => {
      'worklet';
      const content = contentDrag.get();
      if (content.kind === 'idle' || owner.get() === 'reorder') return;
      const { closed: closedHeight, full: fullHeight } = detents.get();
      let remaining = translationY - content.translation;
      if (remaining === 0) return;
      let nextHeight = height.get();
      const scrollRange = scrollContent.get() - scrollViewport.get();
      const maximumOffset = Math.max(0, scrollRange + (nativeD6PaneAvailable ? fullHeight - nextHeight : 0));
      let offset = content.offset;
      if (content.kind === 'native') {
        const nativeOffset = scrollOffset.get();
        contentDrag.set({ kind: 'native', translation: translationY, offset: nativeOffset });
        const towardTop = remaining > 0;
        const edge = towardTop ? 0 : maximumOffset;
        const atEdge = Math.abs(nativeOffset - edge) <= SCROLL_EDGE_TOLERANCE;
        const expanding = direction * remaining > 0;
        if (!atEdge || (expanding ? nextHeight >= fullHeight : nextHeight <= closedHeight)) return;

        const distanceToEdge = Math.abs(Math.max(0, Math.min(maximumOffset, offset)) - edge);
        const overflow = Math.abs(remaining) - (distanceToEdge <= SCROLL_EDGE_TOLERANCE ? 0 : distanceToEdge);
        if (overflow <= 0 || !claimD6Drag(owner, 'pane')) return;
        remaining = Math.sign(remaining) * overflow;
        offset = edge;
        cancelAnimation(height);
        nextHeight = height.get();
        origin.set(nextHeight);
        dragging.set(true);
        runOnJS(begin)();
      }
      const anchoredAtBottom = offset >= maximumOffset - SCROLL_EDGE_TOLERANCE
        && (offset > 0 || remaining < 0);
      if (nextHeight < fullHeight) {
        const resized = Math.max(closedHeight, Math.min(fullHeight, nextHeight + direction * remaining));
        remaining -= direction * (resized - nextHeight);
        nextHeight = resized;
      }
      const nextMaximum = Math.max(0, scrollRange + (nativeD6PaneAvailable ? fullHeight - nextHeight : 0));
      offset = anchoredAtBottom ? nextMaximum : Math.max(0, Math.min(nextMaximum, offset));
      if (nextHeight === fullHeight) {
        const scrolled = Math.max(0, Math.min(nextMaximum, offset - remaining));
        remaining += scrolled - offset;
        offset = scrolled;
        if (direction * remaining < 0) {
          nextHeight = Math.max(closedHeight, fullHeight + direction * remaining);
          if (remaining < 0 && nativeD6PaneAvailable) offset = Math.max(0, scrollRange + fullHeight - nextHeight);
        }
      }
      contentDrag.set({ kind: 'controlled', translation: translationY, offset });
      scrollOffset.set(offset);
      height.set(nextHeight);
      scrollTo(scrollRef, 0, offset, false);
    }, resetContentDrag))
    .onEnd(guardGesture('pane-content-end', ({ velocityY }: { velocityY: number }, success: boolean) => {
      'worklet';
      if (contentDrag.get().kind !== 'controlled' || !success) return;
      dragging.set(false);
      releaseD6Drag(owner, 'pane');
      contentDrag.set({ kind: 'idle' });
      const speed = direction * velocityY;
      const next = releaseDetent(target.get(), origin.get(), height.get(), speed, detents.get(), MAX_CONTENT_SNAP_TRAVEL);
      runOnJS(snapTo)(next, speed);
    }, resetContentDrag))
    .onFinalize(guardGesture('pane-content-finalize', resetContentDrag, resetContentDrag)),
  [interactive, scrollGesture, scrollContent, scrollViewport, scrollOffset, scrollRef, contentDrag, detents,
    height, dragging, direction, begin, snapTo, owner, origin, target, resetContentDrag]);
  const makeChromeGesture = useCallback((chromeDrag: SharedValue<ChromeDrag>) => {
    const resetChromeDrag = () => {
      'worklet';
      const controlled = chromeDrag.get().kind === 'controlled';
      chromeDrag.set({ kind: 'idle' });
      if (!controlled) return;
      dragging.set(false);
      releaseD6Drag(owner, 'pane');
      runOnJS(restore)();
    };
    return Gesture.Pan()
      .enabled(interactive)
      .activeOffsetY([-PAN_ACTIVATION_TRAVEL, PAN_ACTIVATION_TRAVEL])
      .failOffsetX([-PAN_HORIZONTAL_LIMIT, PAN_HORIZONTAL_LIMIT])
      .maxPointers(1)
      .cancelsTouchesInView(true)
      .onTouchesDown(guardGesture('pane-chrome-down', ({ allTouches }: { allTouches: { absoluteY: number }[] }) => {
        'worklet';
        if (allTouches.length !== 1 || owner.get() !== 'idle') return;
        pressCancelled.set(false);
        chromeDrag.set({ kind: 'tracking', startY: allTouches[0].absoluteY });
      }, resetChromeDrag))
      .onStart(guardGesture('pane-chrome-start', ({ absoluteY, translationY }: { absoluteY: number; translationY: number }) => {
        'worklet';
        const chrome = chromeDrag.get();
        if (chrome.kind !== 'tracking' || !claimD6Drag(owner, 'pane')) return;
        // iOS resets pan translation at activation.
        chromeDrag.set({ kind: 'controlled', activationTravel: absoluteY - chrome.startY - translationY });
        pressCancelled.set(true);
        contentDrag.set({ kind: 'idle' });
        dragging.set(true);
        cancelAnimation(height);
        origin.set(height.get());
        runOnJS(begin)();
      }, resetChromeDrag))
      .onUpdate(guardGesture('pane-chrome-update', ({ translationY }: { translationY: number }) => {
        'worklet';
        const chrome = chromeDrag.get();
        if (chrome.kind !== 'controlled' || !dragging.get()) return;
        const { closed: closedHeight, full: fullHeight } = detents.get();
        const travel = chrome.activationTravel + translationY;
        height.set(Math.max(closedHeight, Math.min(fullHeight, origin.get() + direction * travel)));
      }, resetChromeDrag))
      .onEnd(guardGesture('pane-chrome-end', ({ translationY, velocityY }: { translationY: number; velocityY: number }, success: boolean) => {
        'worklet';
        const chrome = chromeDrag.get();
        if (!success || chrome.kind !== 'controlled' || !dragging.get()) return;
        chromeDrag.set({ kind: 'idle' });
        dragging.set(false);
        releaseD6Drag(owner, 'pane');
        const heights = detents.get();
        const speed = direction * velocityY;
        const start = origin.get();
        const travel = chrome.activationTravel + translationY;
        const released = Math.max(heights.closed, Math.min(heights.full, start + direction * travel));
        const next = releaseDetent(target.get(), start, released, speed, heights, MAX_CHROME_SNAP_TRAVEL);
        runOnJS(snapTo)(next, speed);
      }, resetChromeDrag))
      .onFinalize(guardGesture('pane-chrome-finalize', resetChromeDrag, resetChromeDrag));
  }, [interactive, begin, contentDrag, detents, direction, dragging, height, origin, restore, snapTo, owner, pressCancelled, target]);
  const headerGesture = useMemo(() => makeChromeGesture(headerDrag), [makeChromeGesture, headerDrag]);
  const footerGesture = useMemo(() => makeChromeGesture(footerDrag), [makeChromeGesture, footerDrag]);
  const gesture = useMemo(() => makeChromeGesture(grabberDrag), [makeChromeGesture, grabberDrag]);

  return { detent, preview, height, animatedStyle, nativeRef, contentDidLayout, gesture, snapTo, lifecycle, onContentHeight,
    headerGesture, footerGesture, owner, pressCancelled,
    contentGesture, scrollGesture, scrollRef, scrollHandler, scrollContent, scrollViewport, scrollOffset,
    layoutHeight: nativeD6PaneAvailable ? full : closed, closed, full };
}

function SyncPaneHeight({ sync }: { sync: () => void }) {
  useMountEffect(sync);
  return null;
}
