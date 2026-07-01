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
 * button — just above the sheet's live top edge. Drag the grabber to resize;
 * on release it snaps to the nearest detent and reports it via `onIndexChange`.
 *
 * No gesture/animation native deps — plain RN `Animated` + `PanResponder`
 * (JS-driven, since we animate `height`). Content scrolls only at the full
 * detent so a drag on the list at peek/mid resizes the sheet instead.
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

  const min = detents[0];
  const max = detents[detents.length - 1];

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
    let best = 0;
    let bestD = Infinity;
    detents.forEach((d, i) => {
      const dist = Math.abs(d - h);
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    });
    return best;
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => heightAnim.stopAnimation(),
      onPanResponderMove: (_e, g) => {
        const h = Math.max(min - 40, Math.min(max + 60, current.current - g.dy));
        heightAnim.setValue(h);
      },
      onPanResponderRelease: (_e, g) => {
        const h = current.current - g.dy;
        const next = nearest(h);
        springTo(detents[next]);
        onIndexChange(next);
      },
    }),
  ).current;

  return (
    <Animated.View style={[styles.sheet, { height: heightAnim }]}>
      <liquidGlass.GlassView tintColor={glass.sheet} style={StyleSheet.absoluteFill} />
      {/* Grabber — the drag handle. */}
      <View {...pan.panHandlers} style={styles.grabZone}>
        <View style={styles.grabber} />
      </View>
      <ScrollView
        scrollEnabled={index >= detents.length - 1}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 24 }}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 60,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
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
