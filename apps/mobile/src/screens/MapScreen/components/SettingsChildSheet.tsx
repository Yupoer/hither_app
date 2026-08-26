import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Extrapolation,
  interpolate,
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
  initialStage = 0,
  stageTwoRatio = STAGE_TWO_RATIO,
  edgeToEdgeAtLast = true,
  wrapContentInScrollView = true,
}: {
  visible: boolean;
  onClose: () => void;
  onBack?: () => void;
  title: string;
  children: React.ReactNode;
  zIndex?: number;
  /** Root settings opens at Stage 2; child pages keep Stage 1. */
  initialStage?: 0 | 1;
  stageTwoRatio?: number;
  edgeToEdgeAtLast?: boolean;
  wrapContentInScrollView?: boolean;
}) {
  const sheetChildren = React.Children.toArray(children);
  const rootContent = sheetChildren[0] ?? <View />;
  const nestedSheets = sheetChildren.slice(1);
  const { height } = useWindowDimensions();
  const detents = useMemo(
    () => [
      Math.round(height * STAGE_ONE_RATIO),
      Math.round(height * stageTwoRatio),
    ],
    [height, stageTwoRatio],
  );
  const sheetHeight = useSharedValue(0);
  const sheetTranslateY = useSharedValue(0);
  const [index, setIndex] = useState<number>(initialStage);
  const [mounted, setMounted] = useState(visible);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const runUnmount = useCallback(() => setMounted(false), []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setIndex(initialStage);
      sheetTranslateY.value = 0;
      // A zero-height mounted sheet gives every open path the same bottom-up
      // entrance, including the first render after a parent toggles visible.
      sheetHeight.value = withSpring(detents[initialStage], SPRING);
      return;
    }
    // BottomSheet owns the fixed-size translateY exit while this wrapper keeps
    // the content mounted until the panel is fully below the viewport.
    if (!mounted) return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, detents, initialStage, sheetHeight, sheetTranslateY, runUnmount]);

  const handleDismiss = useCallback(() => onCloseRef.current(), []);
  const scrimStyle = useAnimatedStyle(() => ({
    opacity:
      interpolate(sheetHeight.value, [0, detents[0]], [0, 1], Extrapolation.CLAMP)
      * interpolate(
        sheetTranslateY.value,
        [0, height + 40],
        [1, 0],
        Extrapolation.CLAMP,
      ),
  }));

  if (!mounted && !visible) return null;

  const header = (
    <View style={styles.header}>
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
        onDismissComplete={runUnmount}
        dismissRequested={visible}
        dismissTranslateY={sheetTranslateY}
        dismissDistance={height + 40}
        dismissOnDownFromIndex={0}
        edgeToEdgeAtLast={edgeToEdgeAtLast}
        contentTopPadding={12}
        header={header}
      >
        {wrapContentInScrollView ? (initialStage === 1 ? rootContent : children) : children}
      </BottomSheet>
      {initialStage === 1 && nestedSheets.length > 0 ? (
        <View pointerEvents="box-none" style={styles.nestedLayer}>
          {nestedSheets}
        </View>
      ) : null}
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
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 0,
  },
  headerSide: {
    width: 48,
    height: 48,
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
  nestedLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
});
