import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { liquidGlass } from '../native';
import { glass } from '../glass';

/**
 * Apple-Maps-style stacked overlay: a dim scrim plus a raised dark-glass panel
 * that slides up over the main sheet. Used for the search, route (reorder) and
 * settings surfaces. Tapping the scrim or "Done" dismisses it.
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

  useEffect(() => {
    Animated.timing(t, {
      toValue: visible ? 1 : 0,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [visible, t]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });
  const scrimOpacity = t.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          { height: height - insets.top - 8, transform: [{ translateY }] },
        ]}
      >
        <liquidGlass.GlassView tintColor={glass.overlay} style={StyleSheet.absoluteFill} />
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairlineStrong,
  },
  grabZone: { paddingTop: 10, paddingBottom: 4, alignItems: 'center' },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: glass.grabber },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  headerSide: { width: 60 },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  done: { fontSize: 16, fontWeight: '600', textAlign: 'right' },
  body: { flex: 1 },
});
