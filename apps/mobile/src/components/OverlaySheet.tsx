import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
 *
 * When `onDone` is provided, the Done button commits via `onDone` while scrim
 * tap / drag-dismiss still call `onClose` (cancel without committing).
 */
export default function OverlaySheet({
  visible,
  onClose,
  onDone,
  title,
  accent,
  doneLabel = 'Done',
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** If set, Done calls this instead of `onClose` (commit vs cancel). */
  onDone?: () => void;
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
  // Whether the inner ScrollView is scrolled to its top — gates the
  // content-area pull-to-dismiss so it only fires when there's nothing above.
  const atTop = useRef(true);
  // Latest height/onClose for the (once-created) pan responders to read.
  const heightRef = useRef(height);
  heightRef.current = height;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const handleDone = onDone ?? onClose;
  // Keep heavy children mounted through the close animation; drop them only
  // after t has fully settled at 0 while still hidden.
  const [contentMounted, setContentMounted] = useState(visible);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (visible) {
      dragY.setValue(0);
      atTop.current = true;
      setContentMounted(true);
    }
    Animated.timing(t, {
      toValue: visible ? 1 : 0,
      duration: 320,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visibleRef.current) {
        setContentMounted(false);
      }
    });
  }, [visible, t, dragY]);

  // Two drag-to-dismiss responders sharing one release rule: one on the
  // grabber/header (drags anywhere on it), one on the body that only claims a
  // downward drag when the content is already at the top — matching the search
  // sheet, so "finger not on the grabber" still dismisses once you can't scroll
  // up any further.
  const { grabberPan, bodyPan } = useRef(
    (() => {
      const onMove = (_evt: unknown, g: { dy: number }) => {
        if (g.dy > 0) dragY.setValue(g.dy);
      };
      const onRelease = (_evt: unknown, g: { dy: number; vy: number }) => {
        if (g.dy > DISMISS_TRAVEL || g.vy > DISMISS_VELOCITY) {
          // Slide the panel the rest of the way out, THEN unmount-close, so
          // there's no flash back to the top edge before it disappears.
          Animated.timing(dragY, {
            toValue: heightRef.current,
            duration: 160,
            useNativeDriver: true,
          }).start(() => onCloseRef.current());
        } else {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
      };
      return {
        grabberPan: PanResponder.create({
          onMoveShouldSetPanResponder: (_evt, g) =>
            g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
          onPanResponderMove: onMove,
          onPanResponderRelease: onRelease,
        }),
        bodyPan: PanResponder.create({
          onMoveShouldSetPanResponder: (_evt, g) =>
            atTop.current && g.dy > 8 && g.dy > Math.abs(g.dx),
          onPanResponderMove: onMove,
          onPanResponderRelease: onRelease,
        }),
      };
    })(),
  ).current;

  // Fully closed: no glass, children, or cloneElement work.
  if (!contentMounted && !visible) {
    return <View style={StyleSheet.absoluteFill} pointerEvents="none" />;
  }

  // Clone the child (each caller passes a ScrollView) to track whether it's at
  // the top, without every caller having to wire this up.
  const trackedChild = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        scrollEventThrottle: 16,
        onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
          atTop.current = e.nativeEvent.contentOffset.y <= 0;
          (
            children as React.ReactElement<{
              onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
            }>
          ).props.onScroll?.(e);
        },
      })
    : children;

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
        <View {...grabberPan.panHandlers}>
          <View style={styles.grabZone}>
            <View style={styles.grabber} />
          </View>
          <View style={styles.header}>
            <View style={styles.headerSide} />
            <Text style={styles.title}>{title}</Text>
            <Pressable
              onPress={handleDone}
              accessibilityRole="button"
              style={styles.headerSide}
              hitSlop={8}
            >
              <Text style={[styles.done, { color: accent }]}>{doneLabel}</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.body} {...bodyPan.panHandlers}>
          {trackedChild}
        </View>
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairlineSoft,
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
