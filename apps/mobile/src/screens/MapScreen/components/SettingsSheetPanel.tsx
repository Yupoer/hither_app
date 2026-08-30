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
import {
  MAP_SHEET_ACTION_HIT_SIZE,
  MAP_SHEET_EDGE_INSET,
} from '../../../components/mapSheetChrome';
import SheetHeaderAction from '../../../components/SheetHeaderAction';

const STAGE_ONE_RATIO = 0.52;
const STAGE_TWO_RATIO = 0.8;
const SPRING = { stiffness: 320, damping: 29, mass: 1 } as const;

export type SettingsSheetPanelProps = {
  visible: boolean;
  onClose: () => void;
  onDismissComplete?: () => void;
  onBack?: () => void;
  action?: 'close' | 'commit';
  doneLabel?: string;
  onCommit?: () => void;
  title: string;
  children: React.ReactNode;
  zIndex?: number;
  initialStage?: 0 | 1;
  stageTwoRatio?: number;
  edgeToEdgeAtLast?: boolean;
  wrapContentInScrollView?: boolean;
  /** Use one full-width Stage 2 detent instead of the normal two-stage sheet. */
  singleStage?: boolean;
};

/** RN sheet path used by the main settings page for exact full-width geometry. */
export default function SettingsSheetPanel({
  visible,
  onClose,
  onDismissComplete,
  onBack,
  action = 'close',
  doneLabel = action === 'close' ? 'close' : 'commit',
  onCommit,
  title,
  children,
  zIndex = 90,
  initialStage = 0,
  stageTwoRatio = STAGE_TWO_RATIO,
  edgeToEdgeAtLast = true,
  wrapContentInScrollView = true,
  singleStage = false,
}: SettingsSheetPanelProps) {
  const sheetChildren = React.Children.toArray(children);
  const rootContent = sheetChildren[0] ?? <View />;
  const nestedSheets = sheetChildren.slice(1);
  const { height } = useWindowDimensions();
  const detents = useMemo(
    () => singleStage
      ? [Math.round(height * stageTwoRatio)]
      : [
        Math.round(height * STAGE_ONE_RATIO),
        Math.round(height * stageTwoRatio),
      ],
    [height, singleStage, stageTwoRatio],
  );
  const initialIndex = singleStage ? 0 : initialStage;
  const sheetHeight = useSharedValue(0);
  const sheetTranslateY = useSharedValue(0);
  const [index, setIndex] = useState<number>(initialIndex);
  const [mounted, setMounted] = useState(visible);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onDismissCompleteRef = useRef(onDismissComplete);
  onDismissCompleteRef.current = onDismissComplete;
  const runUnmount = useCallback(() => {
    setMounted(false);
    onDismissCompleteRef.current?.();
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setIndex(initialIndex);
      sheetTranslateY.value = 0;
      // Start at zero and spring directly to the selected detent on every open.
      sheetHeight.value = withSpring(detents[initialIndex], SPRING);
      return;
    }
    if (!mounted) return;
    // BottomSheet owns the fixed-size translateY exit while content remains mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, detents, initialIndex, sheetHeight, sheetTranslateY, runUnmount]);

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
          style={styles.headerActionSlot}
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
      ) : <View style={styles.headerActionSlot} />}
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <SheetHeaderAction
        action={action}
        onPress={action === 'commit' ? () => onCommit?.() : onClose}
        accessibilityLabel={doneLabel}
        disabled={action === 'commit' && !onCommit}
        style={styles.headerAction}
      />
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
        {wrapContentInScrollView
          ? (singleStage || initialStage === 1 ? rootContent : children)
          : children}
      </BottomSheet>
      {(singleStage || initialStage === 1) && nestedSheets.length > 0 ? (
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
    paddingHorizontal: MAP_SHEET_EDGE_INSET,
    paddingTop: MAP_SHEET_EDGE_INSET,
    paddingBottom: 0,
  },
  headerActionSlot: {
    width: MAP_SHEET_ACTION_HIT_SIZE,
    height: MAP_SHEET_ACTION_HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAction: {
    width: MAP_SHEET_ACTION_HIT_SIZE,
    height: MAP_SHEET_ACTION_HIT_SIZE,
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
