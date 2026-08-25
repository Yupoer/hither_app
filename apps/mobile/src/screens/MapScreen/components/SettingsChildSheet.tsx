import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { liquidGlass } from '../../../native';
import { glass } from '../../../glass';

const HALF_RATIO = 0.52;
const INSET = 10;
const HALF_RADIUS = 36;
const DISMISS_TRAVEL = 90;
const EXPAND_TRAVEL = 48;

/**
 * Independent settings child sheet: half-open by default (52%, 10px inset),
 * drag up to full-bleed, X or drag down to close. Not a stack push.
 */
export default function SettingsChildSheet({
  visible,
  onClose,
  onBack,
  title,
  children,
  zIndex = 90,
}: {
  visible: boolean;
  onClose: () => void;
  onBack?: () => void;
  title: string;
  children: React.ReactNode;
  zIndex?: number;
}) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [stage, setStage] = useState<1 | 2>(1);
  const t = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const heightRef = useRef(height);
  heightRef.current = height;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setStage(1);
      dragY.setValue(0);
      Animated.timing(t, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(t, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible, t, dragY]);

  const grabberPan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, g) =>
          Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_evt, g) => {
          if (stageRef.current === 1 && g.dy > 0) dragY.setValue(g.dy);
          if (stageRef.current === 2 && g.dy > 0) dragY.setValue(g.dy);
        },
        onPanResponderRelease: (_evt, g) => {
          if (stageRef.current === 1) {
            if (g.dy < -EXPAND_TRAVEL) {
              dragY.setValue(0);
              setStage(2);
              return;
            }
            if (g.dy > DISMISS_TRAVEL || g.vy > 0.6) {
              Animated.timing(dragY, {
                toValue: heightRef.current,
                duration: 160,
                useNativeDriver: true,
              }).start(() => onCloseRef.current());
              return;
            }
          } else if (g.dy > EXPAND_TRAVEL) {
            dragY.setValue(0);
            setStage(1);
            return;
          }
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        },
      }),
    [dragY],
  );

  // Stage 1 content is intentionally a gesture target as well as the grabber:
  // a short upward swipe anywhere in the sheet expands it. Stage 2 leaves
  // scrolling to its child content and keeps collapse on the grabber.
  const bodyPan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, g) =>
          stageRef.current === 1
          && g.dy < -4
          && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_evt, g) => {
          if (stageRef.current === 1 && g.dy < 0) dragY.setValue(g.dy);
        },
        onPanResponderRelease: (_evt, g) => {
          if (stageRef.current === 1 && g.dy < -EXPAND_TRAVEL) {
            dragY.setValue(0);
            setStage(2);
            return;
          }
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        },
      }),
    [dragY],
  );

  if (!mounted && !visible) return null;

  const sheetHeight = stage === 1 ? Math.round(height * HALF_RATIO) : height;
  const inset = stage === 1 ? INSET : 0;
  const radius = stage === 1 ? HALF_RADIUS : 0;
  const translateY = Animated.add(
    t.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }),
    dragY,
  );
  const scrimOpacity = Animated.multiply(
    t,
    dragY.interpolate({
      inputRange: [0, height],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    }),
  );

  return (
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, { zIndex }]}
    >
      <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          {
            left: inset,
            right: inset,
            width: width - inset * 2,
            height: sheetHeight,
            borderTopLeftRadius: radius,
            borderTopRightRadius: radius,
            transform: [{ translateY }],
          },
        ]}
      >
        <liquidGlass.GlassView
          tintColor={glass.overlayOpaque}
          style={StyleSheet.absoluteFill}
        />
        <View {...grabberPan.panHandlers}>
          <View style={styles.grabZone}>
            <View style={styles.grabber} />
          </View>
          <View style={[styles.header, { paddingTop: stage === 2 ? Math.max(8, insets.top) : 4 }]}>
            {onBack ? (
              <Pressable
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="back"
                hitSlop={8}
                style={styles.headerSide}
              >
                <Ionicons name="chevron-back" size={22} color="#fff" />
              </Pressable>
            ) : <View style={styles.headerSide} />}
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="close"
              hitSlop={8}
              style={styles.headerSide}
            >
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>
        <View style={styles.body} {...bodyPan.panHandlers}>{children}</View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(4,7,12,0.35)',
  },
  panel: {
    position: 'absolute',
    bottom: 0,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairlineSoft,
  },
  grabZone: { paddingTop: 10, paddingBottom: 4, alignItems: 'center' },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: glass.grabber },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  headerSide: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: { flex: 1 },
});
