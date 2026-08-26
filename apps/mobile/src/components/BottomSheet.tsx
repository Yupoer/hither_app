import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView as RNScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { liquidGlass } from '../native';
import { glass } from '../glass';
import { settleTarget } from './sheetMath';
import { SHEET_ACTIVE_OFFSET_Y, SHEET_FAIL_OFFSET_X } from '../store/sheetPane';

// ponytail: no RN/Expo API exposes the device's actual screen corner radius;
// this approximates modern iPhones' bezel curve so the full-detent sheet
// (flush with all 4 screen edges) reads as continuous with the physical
// screen corners instead of squaring them off.
const SCREEN_CORNER_RADIUS = 44;

// Height tolerance for "the spring actually reached the full detent".
const EPS = 1;
// Content offset (px) under which the list counts as "at the top" — below this
// a downward drag hands off to the sheet (collapse); above it the list scrolls.
const TOP_EPS = 0.5;
// Vertical finger travel (px) before the sheet-vs-scroll mode locks for the
// whole gesture — small taps and horizontal moves never start a resize.
const DECIDE_PX = 3;
const DISMISS_TRAVEL = 90;
const DISMISS_VELOCITY = 700;

// SwiftUI .spring(response: 0.35, dampingFraction: 0.8) translated:
// stiffness = (2π/0.35)² ≈ 322, damping = 2·0.8·√stiffness ≈ 29.
const SPRING = { stiffness: 320, damping: 29, mass: 1 } as const;

// GH ScrollView (so its native pan can run simultaneously with our Pan) wrapped
// as a reanimated component (so useAnimatedScrollHandler runs on the UI thread
// and scrollTo can pin it from a worklet).
const AnimatedScrollView = Animated.createAnimatedComponent(GHScrollView);

// Gesture mode, locked at the first meaningful move and never flipped mid-drag.
const MODE_NONE = 0;
const MODE_SHEET = 1; // finger resizes the sheet (content pinned)
const MODE_SCROLL = 2; // finger scrolls the content (sheet frozen)

/**
 * Apple-Maps-style pull-up glass sheet with two or more detents.
 *
 * Controlled: the parent owns `height` (a reanimated SharedValue) so it can
 * position floating chrome — the gathering-point carousel and the recenter
 * button — just above the sheet's live top edge, entirely on the UI thread.
 *
 * Gesture handoff (gesture-handler Pan running simultaneously with the list's
 * own scroll, arbitrated in one UI-thread worklet, Apple-Maps decision table):
 *
 *   finger ↑, below full           → sheet expands one step (content pinned)
 *   finger ↑, at full, list scrolled→ content keeps scrolling
 *   finger ↓, list not at top       → content scrolls (sheet frozen)
 *   finger ↓, list at top, ≥ mid    → sheet collapses one step
 *   finger ↓, list at top, at peek  → rubber-bands back
 *
 * The mode is decided once per gesture (start height + direction + scroll
 * offset) and held, so the sheet never jitters between resizing and scrolling.
 * Release settles via the pure sheetMath helpers, carrying the fling velocity.
 */
export default React.memo(function BottomSheet({
  height,
  detents,
  index,
  onIndexChange,
  bottomInset,
  header,
  onHeaderHeight,
  onDismiss,
  onDismissComplete,
  dismissRequested,
  dismissTranslateY,
  dismissDistance,
  dismissOnDownFromIndex,
  edgeToEdgeAtLast = true,
  contentTopPadding = 0,
  compactGrabberSpacing = false,
  hideHeaderOnScroll = false,
  children,
}: {
  /** Live sheet height, owned by the parent (drives sheet + floating chrome). */
  height: SharedValue<number>;
  /** Ascending detent heights, e.g. [peek, mid, full] or [stage1, stage2]. */
  detents: number[];
  index: number;
  onIndexChange: (index: number) => void;
  bottomInset: number;
  /** Chrome pinned over the scroll content on a thin frosted veil (search row). */
  header?: React.ReactNode;
  /** Measured height of the pinned block (grabber + header) — size peek with it. */
  onHeaderHeight?: (h: number) => void;
  /** Close the sheet after a committed downward fling from this detent or above. */
  onDismiss?: () => void;
  /** Called after a translateY-based exit is fully off-screen. */
  onDismissComplete?: () => void;
  /** Controlled visibility for translateY-based sheets. */
  dismissRequested?: boolean;
  /** Shared translateY used by fixed-size sheets during dismissal. */
  dismissTranslateY?: SharedValue<number>;
  /** Distance to move a fixed-size sheet below the viewport. */
  dismissDistance?: number;
  /** Detent index at which a downward drag may dismiss instead of snapping. */
  dismissOnDownFromIndex?: number;
  /** Keep the last detent flush with the screen edges (map sheet default). */
  edgeToEdgeAtLast?: boolean;
  /** Extra space between the pinned header and scroll content. */
  contentTopPadding?: number;
  /** Tighten only the map sheet's grabber spacing without changing other sheets. */
  compactGrabberSpacing?: boolean;
  /** Hide the pinned header controls once full-detent content leaves the top. */
  hideHeaderOnScroll?: boolean;
  children: React.ReactNode;
}) {
  const scrollRef = useAnimatedRef<RNScrollView>();
  // Live scroll offset, mirrored on the UI thread so the Pan worklet can decide
  // "is the list at the top?" without a JS round-trip.
  const scrollOffset = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollOffset.value = e.contentOffset.y;
  });
  const canHideHeader = hideHeaderOnScroll && index === detents.length - 1;
  const [headerHidden, setHeaderHidden] = useState(false);
  useAnimatedReaction(
    () => canHideHeader && scrollOffset.value > TOP_EPS,
    (next, previous) => {
      if (next !== previous) runOnJS(setHeaderHidden)(next);
    },
    [canHideHeader],
  );
  const headerVisibilityStyle = useAnimatedStyle(() => ({
    opacity: canHideHeader && scrollOffset.value > TOP_EPS ? 0 : 1,
  }), [canHideHeader]);

  // Mirror props into SharedValues so pan / sheetStyle worklets always read
  // current detents & inset without rebuilding Gesture.Pan() every render.
  const detentsSV = useSharedValue(detents);
  const bottomInsetSV = useSharedValue(bottomInset);
  const dismissIndexSV = useSharedValue(dismissOnDownFromIndex ?? -1);
  const edgeToEdgeAtLastSV = useSharedValue(edgeToEdgeAtLast ? 1 : 0);
  useEffect(() => {
    detentsSV.value = detents;
    bottomInsetSV.value = bottomInset;
    dismissIndexSV.value = dismissOnDownFromIndex ?? -1;
    edgeToEdgeAtLastSV.value = edgeToEdgeAtLast ? 1 : 0;
  }, [
    bottomInset,
    dismissOnDownFromIndex,
    detents,
    detentsSV,
    edgeToEdgeAtLast,
    edgeToEdgeAtLastSV,
    bottomInsetSV,
    dismissIndexSV,
  ]);

  // Per-gesture state (worklet-owned; reset each onBegin, read through onEnd).
  const gStartH = useSharedValue(detents[index]);
  const gStartScroll = useSharedValue(0);
  const gMode = useSharedValue<number>(MODE_NONE);

  // Height of the pinned header block; the scroll content starts below it.
  const [headerH, setHeaderH] = useState(0);
  const headerHRef = useRef(0);
  const onHeaderHeightRef = useRef(onHeaderHeight);
  onHeaderHeightRef.current = onHeaderHeight;

  // JS settle reads latest detents / onIndexChange via refs so pan can stay
  // memoized (not recreated when parent passes a new detents array identity).
  const detentsRef = useRef(detents);
  detentsRef.current = detents;
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const onDismissCompleteRef = useRef(onDismissComplete);
  onDismissCompleteRef.current = onDismissComplete;
  const dismiss = useCallback(() => onDismissRef.current?.(), []);
  const dismissComplete = useCallback(() => onDismissCompleteRef.current?.(), []);
  const dismissTranslateYInternal = useSharedValue(0);
  const dismissY = dismissTranslateY ?? dismissTranslateYInternal;
  const dismissDistanceSV = useSharedValue(dismissDistance ?? 1000);
  useEffect(() => {
    dismissDistanceSV.value = dismissDistance ?? 1000;
  }, [dismissDistance, dismissDistanceSV]);

  const startTranslateDismiss = useCallback((notifyDismiss: boolean) => {
    cancelAnimation(dismissY);
    dismissY.value = withTiming(
      dismissDistanceSV.value,
      { duration: 220 },
      (finished) => {
        'worklet';
        if (!finished) return;
        if (notifyDismiss) runOnJS(dismiss)();
        runOnJS(dismissComplete)();
      },
    );
  }, [dismissComplete, dismissDistanceSV, dismiss, dismissY]);

  // Controlled close (X / scrim / parent visibility) uses the same fixed-size
  // translateY exit as the gesture path, but must not notify onDismiss twice.
  useEffect(() => {
    if (dismissTranslateY == null || dismissRequested == null) return;
    if (dismissRequested) {
      cancelAnimation(dismissY);
      dismissY.value = 0;
      return;
    }
    startTranslateDismiss(false);
  }, [dismissRequested, dismissTranslateY, dismissY, startTranslateDismiss]);

  // Settle a released sheet-drag on the JS thread — reuses the unit-tested pure
  // helpers, then springs the shared height (carrying the fling velocity) and
  // reports the eager index. gh velocityY is px/s, down-positive; sheetMath
  // wants px/ms with the same sign, and the height grows as the finger rises.
  const settle = useCallback(
    (endH: number, velocityY: number) => {
      const d = detentsRef.current;
      const target = settleTarget({ vy: velocityY / 1000 }, endH, d);
      height.value = withSpring(d[target], { ...SPRING, velocity: -velocityY });
      onIndexChangeRef.current(target);
    },
    [height],
  );

  // Snap when detent *values* change (rotation / header re-measure).
  // Gesture-driven index changes settle via `settle` (not listed as a dep).
  // Use zero restart velocity so a mid-flight remeasure doesn't "kick back".
  const detentsKey = detents.join(',');
  useEffect(() => {
    const nextIndex = Math.max(0, Math.min(index, detents.length - 1));
    height.value = withSpring(detents[nextIndex], { ...SPRING, velocity: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detentsKey, index]);

  // Build pan once: worklets read detentsSV / height / gesture shared values.
  // Do NOT depend on detents array identity — that would recreate every render.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-SHEET_ACTIVE_OFFSET_Y, SHEET_ACTIVE_OFFSET_Y])
        // Fail when horizontal wins so CoverFlow (activeOffsetX) owns left/right swipes.
        .failOffsetX([-SHEET_FAIL_OFFSET_X, SHEET_FAIL_OFFSET_X])
        // AnimatedRef isn't a plain React ref; GH only reads the handler tag off it.
        .simultaneousWithExternalGesture(scrollRef as unknown as React.RefObject<React.ComponentType>)
        .onBegin(() => {
          'worklet';
          cancelAnimation(height);
          if (dismissTranslateY != null) {
            cancelAnimation(dismissY);
            dismissY.value = 0;
          }
          gStartH.value = height.value;
          gMode.value = MODE_NONE;
        })
        .onUpdate((e) => {
          'worklet';
          const d = detentsSV.value;
          const last = d.length - 1;
          if (gMode.value === MODE_NONE) {
            if (Math.abs(e.translationY) < DECIDE_PX) return;
            const atFull = height.value >= d[last] - EPS;
            const goingDown = e.translationY > 0;
            // Apple-Maps decision table, content-first in BOTH directions:
            //  ↓ + list scrolled (any detent) → scroll the list (content priority)
            //  ↓ + list at top                → collapse the sheet one step
            //  ↑ + below full                 → expand the sheet one step
            //  ↑ + at full                    → scroll the list
            if (goingDown && scrollOffset.value > TOP_EPS) gMode.value = MODE_SCROLL;
            else if (goingDown) gMode.value = MODE_SHEET;
            else if (!atFull) gMode.value = MODE_SHEET;
            else gMode.value = MODE_SCROLL;
            gStartScroll.value = scrollOffset.value;
          }
          if (gMode.value === MODE_SHEET) {
            // Fixed-size sheets leave the detent height untouched while a
            // downward dismissal is being decided. Moving the whole panel
            // prevents the old height rubber-band from flashing a larger
            // sheet before it disappears.
            const dismissIndex = dismissIndexSV.value;
            const fixedDismissDrag = dismissTranslateY != null
              && dismissIndex >= 0
              && gStartH.value >= d[dismissIndex] - EPS
              && e.translationY > 0;
            if (fixedDismissDrag) {
              height.value = gStartH.value;
              dismissY.value = Math.min(dismissDistanceSV.value, e.translationY);
              scrollTo(scrollRef, 0, gStartScroll.value, false);
              return;
            }
            if (dismissTranslateY != null) dismissY.value = 0;
            // Position-based: the sheet tracks the finger across the whole detent
            // range (rubber-banding only past the outer ends), so a long drag can
            // jump straight from peek to full instead of stopping one stage on.
            const lo = d[0] - 40;
            const hi = d[last] + 60;
            height.value = Math.max(lo, Math.min(hi, gStartH.value - e.translationY));
            // Hold the list still while the finger resizes the sheet, so a
            // simultaneous native scroll can't leak through. Not a reset-to-top:
            // it pins to wherever the drag started (≈0 whenever a sheet-drag is
            // possible), and only for the life of this gesture.
            scrollTo(scrollRef, 0, gStartScroll.value, false);
          }
        })
        .onEnd((e) => {
          'worklet';
          if (gMode.value === MODE_SHEET) {
            const d = detentsSV.value;
            const dismissIndex = dismissIndexSV.value;
            const canDismiss = dismissIndex >= 0
              && dismissIndex < d.length
              && gStartH.value >= d[dismissIndex] - EPS
              && (e.translationY > DISMISS_TRAVEL || e.velocityY > DISMISS_VELOCITY);
            if (canDismiss) {
              if (dismissTranslateY != null) {
                cancelAnimation(dismissY);
                dismissY.value = withTiming(
                  dismissDistanceSV.value,
                  { duration: 220 },
                  (finished) => {
                    'worklet';
                    if (finished) {
                      runOnJS(dismiss)();
                      runOnJS(dismissComplete)();
                    }
                  },
                );
              } else {
                height.value = withSpring(0, SPRING, (finished) => {
                  'worklet';
                  if (finished) runOnJS(dismiss)();
                });
              }
            } else {
              if (dismissTranslateY != null) {
                dismissY.value = withSpring(0, SPRING);
                runOnJS(settle)(gStartH.value - e.translationY, e.velocityY);
              } else {
                runOnJS(settle)(height.value, e.velocityY);
              }
            }
          }
          gMode.value = MODE_NONE;
        }),
    // Stable shared values + settle + height + scrollRef only — not detents[].
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      height,
      settle,
      scrollRef,
      detentsSV,
      dismissIndexSV,
      gStartH,
      gMode,
      gStartScroll,
      scrollOffset,
      dismiss,
      dismissComplete,
      dismissDistanceSV,
      dismissTranslateY,
      dismissY,
    ],
  );

  // Apple-Maps stage morphing, all on the UI thread: peek floats far off every
  // edge (small and dainty), mid hugs the edges at the search bar's gap, full
  // fills the screen flush so all 4 corners coincide with the physical screen
  // corners. Top corner radius stays constant; bottom corners become square at
  // the full-height detent so the sheet fills the screen edge-to-edge.
  const sheetStyle = useAnimatedStyle(() => {
    const h = height.value;
    const d = detentsSV.value;
    const last = d.length - 1;
    // peek/mid share the same horizontal inset so sheet chrome (e.g. 成員/路線/工具
    // Segmented) does not appear to scale when moving between stage 1 and 2.
    // Full still goes edge-to-edge.
    const side = interpolate(
      h,
      d,
      d.map((_, i) => (edgeToEdgeAtLastSV.value && i === last ? 0 : 10)),
      Extrapolation.CLAMP,
    );
    const topRadius = SCREEN_CORNER_RADIUS;
    // Stage 2 and full are edge-filled surfaces: only the floating peek stage
    // keeps bottom rounding, otherwise the map can show through at both corners.
    const bottomRadius = interpolate(h, d, d.map((_, i) => (
      edgeToEdgeAtLastSV.value && i === last ? 0 : SCREEN_CORNER_RADIUS
    )), Extrapolation.CLAMP);
    return {
      height: h,
      bottom: sheetBottomOffset(h, d, bottomInsetSV.value),
      left: side,
      right: side,
      borderTopLeftRadius: topRadius,
      borderTopRightRadius: topRadius,
      borderBottomLeftRadius: bottomRadius,
      borderBottomRightRadius: bottomRadius,
      transform: [{ translateY: dismissY.value }],
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.sheet, sheetStyle]}>
        <liquidGlass.GlassView
          // iOS uses the system material without an artificial opaque tint so
          // the map remains visible at Peek and the same surface survives
          // Stage 1/2. Android keeps its solid fallback.
          tintColor={Platform.OS === 'android' ? glass.sheetOpaque : undefined}
          style={StyleSheet.absoluteFill}
        />
        <AnimatedScrollView
          ref={scrollRef}
          // Only enabled once truly resting at the last detent. The Pan
          // worklet already refuses to enter MODE_SCROLL below full (see the
          // decision table above), so this was previously dead protection —
          // except gesture-handler's native scroll recognizer still competes
          // for the touch whenever `scrollEnabled` is true, letting a hair of
          // real scroll leak through while a mid→full expand drag is being
          // pinned every frame. Gating on the *committed* index (not `>= 1`)
          // keeps the recognizer fully off until a brand-new gesture starts
          // at full, so content genuinely can't move mid-transition.
          scrollEnabled={index === detents.length - 1}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 40,
            paddingTop: headerH + contentTopPadding,
          }}
        >
          {children}
        </AnimatedScrollView>
        {/* Header stays transparent so the sheet uses one native material
            surface instead of stacking a second blur over the map. */}
        <View
          style={styles.headerBlock}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h === headerHRef.current) return;
            headerHRef.current = h;
            setHeaderH(h);
            onHeaderHeightRef.current?.(h);
          }}
        >
          <View style={compactGrabberSpacing ? styles.grabZoneCompact : styles.grabZone}>
            <View style={styles.grabber} />
          </View>
          <Animated.View
            style={headerVisibilityStyle}
            pointerEvents={canHideHeader && headerHidden ? 'none' : 'auto'}
          >
            {header}
          </Animated.View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

/**
 * The sheet's live gap to the screen bottom (peek floats high, full sits
 * flush) for a given height. A worklet-safe pure function so both the sheet's
 * own `useAnimatedStyle` and MapScreen's floating chrome can stack on the same
 * baseline as the sheet's top edge, all on the UI thread.
 */
export function sheetBottomOffset(
  h: number,
  detents: number[],
  bottomInset: number,
): number {
  'worklet';
  return interpolate(
    h,
    detents,
    detents.map((_, index) => (index === 0 ? bottomInset + 19 : 0)),
    Extrapolation.CLAMP,
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    zIndex: 60,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    // Apple-like separator gray (not transparent → material white halo).
    borderColor: glass.hairlineSoft,
  },
  headerBlock: { position: 'absolute', top: 0, left: 0, right: 0 },
  // Tighter top so peek chrome sits closer to the sheet edge.
  grabZone: { paddingTop: 6, paddingBottom: 4, alignItems: 'center' },
  grabZoneCompact: { paddingTop: 3, paddingBottom: 2, alignItems: 'center' },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: glass.grabber,
  },
});
