import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import BottomSheet from '../../../components/BottomSheet';

const STAGE_ONE_RATIO = 0.52;
const STAGE_TWO_RATIO = 0.8;
const SPRING = { stiffness: 320, damping: 29, mass: 1 } as const;

/** Settings uses the same Reanimated/Gesture Handler sheet as every other sheet. */
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
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const detents = useMemo(
    () => [
      Math.round(height * STAGE_ONE_RATIO),
      Math.round(height * STAGE_TWO_RATIO),
    ],
    [height],
  );
  const sheetHeight = useSharedValue(detents[0]);
  const [index, setIndex] = useState(0);
  const [mounted, setMounted] = useState(visible);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const runUnmount = useCallback(() => setMounted(false), []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setIndex(0);
      sheetHeight.value = withSpring(detents[0], SPRING);
      return;
    }
    if (!mounted) return;
    sheetHeight.value = withSpring(0, SPRING, (finished) => {
      'worklet';
      if (finished) runOnJS(runUnmount)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, detents[0], detents[1]]);

  const handleDismiss = useCallback(() => onCloseRef.current(), []);
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetHeight.value, [0, detents[0]], [0, 1], Extrapolation.CLAMP),
  }));

  if (!mounted && !visible) return null;

  const header = (
    <View
      style={[styles.header, { paddingTop: Math.max(4, insets.top) }]}
    >
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
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
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
  );

  return (
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, { zIndex }]}
    >
      <Animated.View style={[styles.scrim, scrimStyle]} pointerEvents={visible ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <BottomSheet
        height={sheetHeight}
        detents={detents}
        index={index}
        onIndexChange={setIndex}
        bottomInset={0}
        onDismiss={handleDismiss}
        dismissOnDownFromIndex={0}
        edgeToEdgeAtLast={false}
        header={header}
      >
        {children}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(4,7,12,0.35)',
  },
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
});
