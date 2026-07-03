import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { liquidGlass } from '../native';
import { glass } from '../glass';
import { nearestDetent, settleTarget } from './sheetMath';

// ponytail: no RN/Expo API exposes the device's actual screen corner radius;
// this approximates modern iPhones' bezel curve so the full-detent sheet
// (flush with all 4 screen edges) reads as continuous with the physical
// screen corners instead of squaring them off.
const SCREEN_CORNER_RADIUS = 44;

// Height tolerance for "the spring actually reached the full detent".
const EPS = 1;
// Top-overscroll depth (px, finger down) that steps full back down to mid.
const COLLAPSE_PULL = 48;

/**
 * Apple-Maps-style pull-up glass sheet with three detents (peek / mid / full).
 *
 * Controlled: the parent owns `heightAnim` (an Animated.Value) so it can also
 * position floating chrome — the gathering-point carousel and the recenter
 * button — just above the sheet's live top edge. Drag anywhere on the sheet to
 * resize; movement is STEPWISE: both the live drag (clamped to the
 * neighbouring detents) and the release settle move at most one detent per
 * gesture, so peek always passes mid before full and full always passes mid
 * before peek, reported via `onIndexChange`.
 *
 * No gesture/animation native deps — plain RN `Animated` + `PanResponder`
 * (JS-driven, since we animate `height`). Below full every vertical drag
 * resizes the sheet. Once the sheet has ACTUALLY reached full (live height,
 * not the eager index — an expanding sheet never scrolls mid-spring) the list
 * owns every gesture, both directions; collapsing back to mid is driven by
 * the list's own native top-overscroll (finger down, pulled past
 * COLLAPSE_PULL), never by stealing the pan — the old JS-mirrored scroll
 * offset went stale under load and ate scrolls. The grabber/header always
 * resize: the escape hatch, same as Apple Maps.
 */
export default function BottomSheet({
  heightAnim,
  detents,
  index,
  onIndexChange,
  bottomInset,
  header,
  onHeaderHeight,
  children,
}: {
  heightAnim: Animated.Value;
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
  // Track the live height so a drag can start from wherever the spring left it.
  const current = useRef(detents[index]);
  // "Actually open" — derived from the LIVE height, not the eager `index`
  // prop: `onIndexChange` fires when a release settles, i.e. before the
  // spring lands, and gating the list on that let content scroll while the
  // sheet was still expanding.
  const [atFull, setAtFull] = useState(index >= detents.length - 1);
  const atFullRef = useRef(atFull);
  const scrollRef = useRef<ScrollView | null>(null);
  useEffect(() => {
    const id = heightAnim.addListener(({ value }) => {
      current.current = value;
      const ds = detentsRef.current;
      const nf = value >= ds[ds.length - 1] - EPS;
      if (nf !== atFullRef.current) {
        atFullRef.current = nf;
        setAtFull(nf);
        // Leaving full: park the list back at its top so mid/peek always
        // present the content from the very start, never mid-scroll.
        if (!nf) scrollRef.current?.scrollTo({ y: 0, animated: false });
      }
    });
    return () => heightAnim.removeListener(id);
  }, [heightAnim]);

  // Live refs so the (once-created) responder always sees fresh values.
  const detentsRef = useRef(detents);
  detentsRef.current = detents;
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  // Height at the moment the finger went down — the anchor every move offsets
  // from. (Offsetting from the LIVE height compounded the cumulative dy on
  // every move event, so a tiny drag flew straight to full.)
  const startH = useRef(detents[index]);
  // Detent the drag started from — the live drag is clamped to its neighbours.
  const startIdx = useRef(index);

  // True while a finger is actually on the list — a momentum bounce off the
  // top can overshoot past COLLAPSE_PULL too, and must not collapse the sheet.
  const scrollDragging = useRef(false);
  // One collapse per touch — the overscroll region keeps streaming events
  // while the sheet springs down.
  const collapsed = useRef(false);

  // Height of the pinned header block; the scroll content starts below it.
  const [headerH, setHeaderH] = useState(0);
  const headerHRef = useRef(0);
  const onHeaderHeightRef = useRef(onHeaderHeight);
  onHeaderHeightRef.current = onHeaderHeight;

  // SwiftUI .spring(response: 0.35, dampingFraction: 0.8) translated:
  // stiffness = (2π/0.35)² ≈ 322, damping = 2·0.8·√stiffness ≈ 29.
  const springTo = (h: number, velocity = 0) =>
    Animated.spring(heightAnim, {
      toValue: h,
      useNativeDriver: false,
      stiffness: 320,
      damping: 29,
      mass: 1,
      velocity,
    }).start();

  // Snap to the detent when the parent changes `index` (tap / programmatic).
  useEffect(() => {
    springTo(detents[index]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, detents[0], detents[1], detents[2]]);

  const settleAt = (next: number, velocity = 0) => {
    springTo(detentsRef.current[next], velocity);
    onIndexChangeRef.current(next);
  };

  const pan = useRef(
    PanResponder.create({
      // Capture vertical drags anywhere on the sheet while below full (LIVE
      // height — mid-spring counts as "not full yet"), so the sheet resizes.
      // At full the list owns every gesture — scrolling both ways — and the
      // collapse is triggered by the list's top-overscroll (see onScroll),
      // so there is nothing to capture here.
      onMoveShouldSetPanResponderCapture: (_e, g) => {
        if (Math.abs(g.dy) < 6 || Math.abs(g.dy) < Math.abs(g.dx)) return false;
        const ds = detentsRef.current;
        return current.current < ds[ds.length - 1] - EPS;
      },
      // Bubbled moves (no child claimed them — the grabber zone and the
      // pinned header) always resize, so both work even at full with the
      // list scrolled: the escape hatch, same as Apple Maps.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        // Anchor synchronously — stopAnimation's callback lands a frame
        // later, too late for the first move of a spring-interrupting grab.
        startH.current = current.current;
        startIdx.current = nearestDetent(current.current, detentsRef.current);
        heightAnim.stopAnimation((v) => {
          startH.current = v;
          current.current = v;
          startIdx.current = nearestDetent(v, detentsRef.current);
        });
      },
      onPanResponderMove: (_e, g) => {
        const ds = detentsRef.current;
        const last = ds.length - 1;
        const si = startIdx.current;
        // One stage per gesture: the drag itself stops at the neighbouring
        // detents (rubber-band only past the outer ends), so a single swipe
        // can never carry peek straight to full.
        const lo = si === 0 ? ds[0] - 40 : ds[si - 1];
        const hi = si === last ? ds[last] + 60 : ds[si + 1];
        heightAnim.setValue(Math.max(lo, Math.min(hi, startH.current - g.dy)));
      },
      // Feed the release velocity into the settle spring (px/ms → px/s;
      // height grows as the finger moves up) so the sheet carries the
      // gesture's momentum instead of restarting from rest.
      onPanResponderRelease: (_e, g) =>
        settleAt(
          settleTarget(g, current.current, startIdx.current, detentsRef.current),
          -g.vy * 1000,
        ),
      onPanResponderTerminate: () =>
        settleAt(nearestDetent(current.current, detentsRef.current)),
    }),
  ).current;

  // Apple-Maps stage morphing: peek floats far off every edge (small and
  // dainty), mid hugs the edges at the search bar's gap, full fills the screen
  // flush — all 4 corners then coincide with the physical screen corners, so
  // they curve to match the device bezel instead of squaring off.
  const sideInset = heightAnim.interpolate({
    inputRange: detents,
    outputRange: [20, 10, 0],
    extrapolate: 'clamp',
  });
  const bottomOff = sheetBottomOffset(heightAnim, detents, bottomInset);
  // Peek (Stage 1) reads rounder to match the fully-pill search capsule
  // inside it; the old [26, 22, ...] dipped smaller at mid before growing
  // again at full, which looked inconsistent as the sheet resized.
  const topRadius = heightAnim.interpolate({
    inputRange: detents,
    outputRange: [30, 34, SCREEN_CORNER_RADIUS],
    extrapolate: 'clamp',
  });
  const bottomRadius = heightAnim.interpolate({
    inputRange: detents,
    outputRange: [30, 34, SCREEN_CORNER_RADIUS],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          height: heightAnim,
          bottom: bottomOff,
          left: sideInset,
          right: sideInset,
          borderTopLeftRadius: topRadius,
          borderTopRightRadius: topRadius,
          borderBottomLeftRadius: bottomRadius,
          borderBottomRightRadius: bottomRadius,
        },
      ]}
      {...pan.panHandlers}
    >
      <liquidGlass.GlassView tintColor={glass.sheet} style={StyleSheet.absoluteFill} />
      <ScrollView
        ref={scrollRef}
        scrollEnabled={atFull}
        // Top-overscroll collapse: with the content back at the top, keep
        // pulling down (finger on) past COLLAPSE_PULL and the sheet steps
        // back to mid. Native contentOffset drives it, so nothing goes stale.
        // ponytail: iOS-only mechanism — Android clamps overscroll at 0;
        // re-add a pan-capture path there if Android ever ships.
        bounces
        alwaysBounceVertical
        onScrollBeginDrag={() => {
          scrollDragging.current = true;
          collapsed.current = false;
        }}
        onScrollEndDrag={() => (scrollDragging.current = false)}
        onScroll={(e) => {
          if (
            atFullRef.current &&
            scrollDragging.current &&
            !collapsed.current &&
            e.nativeEvent.contentOffset.y < -COLLAPSE_PULL
          ) {
            collapsed.current = true;
            scrollRef.current?.scrollTo({ y: 0, animated: false });
            settleAt(detentsRef.current.length - 2);
          }
        }}
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
      </ScrollView>
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
  );
}

/**
 * The sheet's live gap to the screen bottom (peek floats high, full sits
 * flush). Exported so MapScreen can stack the floating chrome (carousel,
 * recenter) on the same baseline as the sheet's top edge.
 */
export function sheetBottomOffset(
  heightAnim: Animated.Value,
  detents: number[],
  bottomInset: number,
): Animated.AnimatedInterpolation<number> {
  return heightAnim.interpolate({
    inputRange: detents,
    outputRange: [bottomInset + 19, 10, 0],
    extrapolate: 'clamp',
  });
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
