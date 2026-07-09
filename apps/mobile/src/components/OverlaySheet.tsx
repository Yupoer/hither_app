import React, { useEffect, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { liquidGlass } from '../native';
import { glass } from '../glass';

// Drag the handle/header down past this many px (or fling it) to dismiss —
// matches the iOS sheet feel so "Done" is never the only way out.
const DISMISS_TRAVEL = 90;
const DISMISS_VELOCITY = 0.6;

/**
 * Apple-Maps-style stacked overlay: a dim scrim plus a raised dark-glass panel
 * that slides up over the main sheet. Used for the search, route (reorder),
 * settings, feedback and meet-time surfaces. Dismiss by tapping the scrim or
 * "Done", OR by dragging the grabber/header straight down.
 */
export default function OverlaySheet({
  visible,
  onClose,
  title,
  accent,
  doneLabel = 'Done',
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  accent: string;
  doneLabel?: string;
  children: React.ReactNode;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const t = useRef(new Animated.Value(0)).current; // 0 hidden → 1 shown
  // Live finger offset while drag-dismissing; added on top of the show/hide
  // translate. Reset to 0 every time the sheet re-opens (see effect below).
  const dragY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) dragY.setValue(0);
    Animated.timing(t, {
      toValue: visible ? 1 : 0,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [visible, t, dragY]);

  // Drag-to-dismiss on the grabber/header region. Only claims clearly-downward
  // drags, so horizontal taps and the header's "Done" button still work.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, g) =>
        g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_evt, g) => {
        if (g.dy > 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_evt, g) => {
        if (g.dy > DISMISS_TRAVEL || g.vy > DISMISS_VELOCITY) {
          // Slide the panel the rest of the way out, THEN unmount-close, so
          // there's no flash back to the top edge before it disappears.
          Animated.timing(dragY, {
            toValue: height,
            duration: 160,
            useNativeDriver: true,
          }).start(() => onClose());
        } else {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
      },
    }),
  ).current;

  const translateY = Animated.add(
    t.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }),
    dragY,
  );
  // Scrim fades with the show/hide progress AND as the panel is dragged away.
  const scrimOpacity = Animated.multiply(
    t,
    dragY.interpolate({
      inputRange: [0, height],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    }),
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          { height: height - insets.top - 16, transform: [{ translateY }] },
        ]}
      >
        <liquidGlass.GlassView tintColor={glass.overlay} style={StyleSheet.absoluteFill} />
        <View {...pan.panHandlers}>
          <View style={styles.grabZone}>
            <View style={styles.grabber} />
          </View>
          <View style={styles.header}>
            <View style={styles.headerSide} />
            <Text style={styles.title}>{title}</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={styles.headerSide}
              hitSlop={8}
            >
              <Text style={[styles.done, { color: accent }]}>{doneLabel}</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.body}>{children}</View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: glass.scrim },
  panel: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 0,
    zIndex: 80,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderColor: glass.hairlineStrong,
  },
  // More breathing room so the title doesn't crowd the sheet's top edge.
  grabZone: { paddingTop: 14, paddingBottom: 6, alignItems: 'center' },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: glass.grabber },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 18,
  },
  headerSide: { width: 60 },
  title: { fontSize: 19, fontWeight: '700', color: '#fff' },
  done: { fontSize: 16, fontWeight: '600', textAlign: 'right' },
  body: { flex: 1 },
});
