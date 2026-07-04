import React, { useEffect, useRef, useState } from 'react';
import { ScrollView as RNScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { liquidGlass } from '../native';
import { glass } from '../glass';
import { settleTarget } from './sheetMath';

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
 * Apple-Maps-style pull-up glass sheet with three detents (peek / mid / full).
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
export default function BottomSheet({
  height,
  detents,
  index,
  onIndexChange,
  bottomInset,
  header,
  onHeaderHeight,
  children,
}: {
  /** Live sheet height, owned by the parent (drives sheet + floating chrome). */
  height: SharedValue<number>;
  /** Ascending detent heights [peek, mid, full]. */
  detents: number[];
  index: number;
  onIndexChange: (index: number) => void;
  bottomInset: number;
  /** Chrome pinned over the scroll content on a thin frosted veil (search row). */
  header?: React.ReactNode;
  /** Measured height of the pinned block (grabber + header) — size peek with it. */
  onHeaderHeight?: (h: number) => void;
  children: React.ReactNode;
}) {
  const scrollRef = useAnimatedRef<RNScrollView>();
  // Live scroll offset, mirrored on the UI thread so the Pan worklet can decide
  // "is the list at the top?" without a JS round-trip.
  const scrollOffset = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollOffset.value = e.contentOffset.y;
  });

  // Per-gesture state (worklet-owned; reset each onBegin, read through onEnd).
  const gStartH = useSharedValue(detents[index]);
  const gStartScroll = useSharedValue(0);
  const gStartIdx = useSharedValue(index);
  const gMode = useSharedValue<number>(MODE_NONE);

  // Height of the pinned header block; the scroll content starts below it.
  const [headerH, setHeaderH] = useState(0);
  const headerHRef = useRef(0);
  const onHeaderHeightRef = useRef(onHeaderHeight);
  onHeaderHeightRef.current = onHeaderHeight;

  // Settle a released sheet-drag on the JS thread — reuses the unit-tested pure
  // helpers, then springs the shared height (carrying the fling velocity) and
  // reports the eager index. gh velocityY is px/s, down-positive; sheetMath
  // wants px/ms with the same sign, and the height grows as the finger rises.
  const settle = (endH: number, startIdx: number, velocityY: number) => {
    const target = settleTarget({ vy: velocityY / 1000 }, endH, startIdx, detents);
    height.value = withSpring(detents[target], { ...SPRING, velocity: -velocityY });
    onIndexChange(target);
  };

  // Snap to the current detent whenever the detent *values* change (rotation,
  // header re-measure). Gesture-driven index changes are settled by `settle`
  // above, so they are deliberately NOT a dependency here.
  useEffect(() => {
    height.value = withSpring(detents[index], SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detents[0], detents[1], detents[2]]);

  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    // AnimatedRef isn't a plain React ref; GH only reads the handler tag off it.
    .simultaneousWithExternalGesture(scrollRef as unknown as React.RefObject<React.ComponentType>)
    .onBegin(() => {
      'worklet';
      cancelAnimation(height);
      gStartH.value = height.value;
      gMode.value = MODE_NONE;
      // Nearest detent to the start height — the live drag is clamped to its
      // neighbours so one swipe never skips a stage. (Inlined: nearestDetent is
      // JS-only; this 3-element scan is its worklet-safe twin.)
      let si = 0;
      let bd = Infinity;
      for (let i = 0; i < detents.length; i++) {
        const dist = Math.abs(detents[i] - gStartH.value);
        if (dist < bd) {
          bd = dist;
          si = i;
        }
      }
      gStartIdx.value = si;
    })
    .onUpdate((e) => {
      'worklet';
      const last = detents.length - 1;
      if (gMode.value === MODE_NONE) {
        if (Math.abs(e.translationY) < DECIDE_PX) return;
        const atFull = height.value >= detents[last] - EPS;
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
        const si = gStartIdx.value;
        // One stage per gesture: clamp to the neighbouring detents, rubber-band
        // only past the outer ends.
        const lo = si === 0 ? detents[0] - 40 : detents[si - 1];
        const hi = si === last ? detents[last] + 60 : detents[si + 1];
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
        runOnJS(settle)(height.value, gStartIdx.value, e.velocityY);
      }
      gMode.value = MODE_NONE;
    });

  // Apple-Maps stage morphing, all on the UI thread: peek floats far off every
  // edge (small and dainty), mid hugs the edges at the search bar's gap, full
  // fills the screen flush so all 4 corners coincide with the physical screen
  // corners and curve to match the device bezel instead of squaring off.
  const sheetStyle = useAnimatedStyle(() => {
    const h = height.value;
    const side = interpolate(h, detents, [20, 10, 0], Extrapolation.CLAMP);
    const radius = interpolate(
      h,
      detents,
      [30, 34, SCREEN_CORNER_RADIUS],
      Extrapolation.CLAMP,
    );
    return {
      height: h,
      bottom: sheetBottomOffset(h, detents, bottomInset),
      left: side,
      right: side,
      borderTopLeftRadius: radius,
      borderTopRightRadius: radius,
      borderBottomLeftRadius: radius,
      borderBottomRightRadius: radius,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.sheet, sheetStyle]}>
        <liquidGlass.GlassView tintColor={glass.sheet} style={StyleSheet.absoluteFill} />
        <AnimatedScrollView
          ref={scrollRef}
          // Enabled at mid + full (peek has no room to scroll). Scroll position
          // is never auto-reset — handoff is arbitrated live in the Pan worklet.
          scrollEnabled={index >= 1}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 24,
            paddingTop: headerH,
          }}
        >
          {children}
        </AnimatedScrollView>
        {/* Grabber + header float over the content on their own thin frosted
            veil, so scrolled content visibly blurs as it slides beneath them
            (and never pokes out above — the veil covers the grab zone too). */}
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
          <liquidGlass.GlassView tintColor={glass.headerVeil} style={StyleSheet.absoluteFill} />
          <View style={styles.grabZone}>
            <View style={styles.grabber} />
          </View>
          {header}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

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
    [bottomInset + 19, 10, 0],
    Extrapolation.CLAMP,
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    zIndex: 60,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
  },
  headerBlock: { position: 'absolute', top: 0, left: 0, right: 0 },
  grabZone: { paddingTop: 10, paddingBottom: 6, alignItems: 'center' },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: glass.grabber,
  },
});
