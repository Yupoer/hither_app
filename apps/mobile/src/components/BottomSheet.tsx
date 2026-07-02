import React, { useEffect, useRef } from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { liquidGlass } from '../native';
import { glass } from '../glass';

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
  children,
}: {
  heightAnim: Animated.Value;
  /** Ascending detent heights [peek, mid, full]. */
  detents: number[];
  index: number;
  onIndexChange: (index: number) => void;
  bottomInset: number;
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

  return (
    <Animated.View
      style={[styles.sheet, { height: heightAnim, bottom: bottomInset + 10 }]}
      {...pan.panHandlers}
    >
      <liquidGlass.GlassView tintColor={glass.sheet} style={StyleSheet.absoluteFill} />
      {/* Grabber — visual affordance; the whole sheet drags. */}
      <View style={styles.grabZone}>
        <View style={styles.grabber} />
      </View>
      <ScrollView
        scrollEnabled={index >= detents.length - 1}
        onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Floating inset panel, Apple-Maps style: padded off every screen edge and
  // rounded on all corners, at every detent.
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 60,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
  },
  grabZone: { paddingTop: 10, paddingBottom: 6, alignItems: 'center' },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: glass.grabber,
  },
});
