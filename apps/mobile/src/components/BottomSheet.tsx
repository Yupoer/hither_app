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

// ponytail: no RN/Expo API exposes the device's actual screen corner radius;
// this approximates modern iPhones' bezel curve so the full-detent sheet
// (flush with all 4 screen edges) reads as continuous with the physical
// screen corners instead of squaring them off.
const SCREEN_CORNER_RADIUS = 44;

/**
 * Apple-Maps-style pull-up glass sheet with three detents (peek / mid / full).
 *
 * Controlled: the parent owns `heightAnim` (an Animated.Value) so it can also
 * position floating chrome — the gathering-point carousel and the recenter
 * button — just above the sheet's live top edge. Drag anywhere on the sheet to
 * resize; on release it snaps to the nearest detent (projecting the fling
 * velocity, so a flick jumps a detent) and reports it via `onIndexChange`.
 *
 * No gesture/animation native deps — plain RN `Animated` + `PanResponder`
 * (JS-driven, since we animate `height`). Content scrolls only at the full
 * detent; there, pulling down from the top of the list collapses the sheet.
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
  useEffect(() => {
    const id = heightAnim.addListener(({ value }) => (current.current = value));
    return () => heightAnim.removeListener(id);
  }, [heightAnim]);

  // Live refs so the (once-created) responder always sees fresh values.
  const indexRef = useRef(index);
  indexRef.current = index;
  const detentsRef = useRef(detents);
  detentsRef.current = detents;
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  // Height at the moment the finger went down — the anchor every move offsets
  // from. (Offsetting from the LIVE height compounded the cumulative dy on
  // every move event, so a tiny drag flew straight to full.)
  const startH = useRef(detents[index]);
  const scrollY = useRef(0);

  // Height of the pinned header block; the scroll content starts below it.
  const [headerH, setHeaderH] = useState(0);
  const headerHRef = useRef(0);
  const onHeaderHeightRef = useRef(onHeaderHeight);
  onHeaderHeightRef.current = onHeaderHeight;

  const springTo = (h: number) =>
    Animated.spring(heightAnim, {
      toValue: h,
      useNativeDriver: false,
      bounciness: 2,
      speed: 14,
    }).start();

  // Snap to the detent when the parent changes `index` (tap / programmatic).
  useEffect(() => {
    springTo(detents[index]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, detents[0], detents[1], detents[2]]);

  const nearest = (h: number) => {
    const ds = detentsRef.current;
    let best = 0;
    let bestD = Infinity;
    ds.forEach((d, i) => {
      const dist = Math.abs(d - h);
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    });
    return best;
  };

  const settle = (h: number) => {
    const next = nearest(h);
    springTo(detentsRef.current[next]);
    onIndexChangeRef.current(next);
  };

  const pan = useRef(
    PanResponder.create({
      // Capture vertical drags anywhere on the sheet. At the full detent the
      // list owns scrolling, so only a pull-down from the very top collapses.
      onMoveShouldSetPanResponderCapture: (_e, g) => {
        if (Math.abs(g.dy) < 6 || Math.abs(g.dy) < Math.abs(g.dx)) return false;
        const atFull = indexRef.current >= detentsRef.current.length - 1;
        if (atFull) return g.dy > 0 && scrollY.current <= 0;
        return true;
      },
      // Bubbled moves (no child claimed them — i.e. the grabber zone) always
      // resize, so the grabber works even at full with the list scrolled.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        heightAnim.stopAnimation((v) => {
          startH.current = v;
          current.current = v;
        });
      },
      onPanResponderMove: (_e, g) => {
        const ds = detentsRef.current;
        const h = Math.max(
          ds[0] - 40,
          Math.min(ds[ds.length - 1] + 60, startH.current - g.dy),
        );
        heightAnim.setValue(h);
      },
      onPanResponderRelease: (_e, g) => {
        // Project the fling (~200 ms of glide, vy is px/ms) so a flick moves a
        // detent while a slow drag still snaps to whichever edge is nearest.
        settle(startH.current - g.dy - g.vy * 200);
      },
      onPanResponderTerminate: () => settle(current.current),
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
        scrollEnabled={index >= detents.length - 1}
        onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
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
    outputRange: [bottomInset + 16, 10, 0],
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
