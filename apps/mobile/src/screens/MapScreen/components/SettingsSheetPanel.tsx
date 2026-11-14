import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppText as Text } from '../../../components/AppText';
import Pressable from '../../../components/MotionPressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import BottomSheet from '../../../components/BottomSheet';
import {
  MAP_SHEET_ACTION_HIT_SIZE,
  MAP_SHEET_COMPACT_GRABBER_HEIGHT,
  MAP_SHEET_GRABBER_HEIGHT,
  SHEET_CORNER_ACTION_INSET,
} from '../../../components/mapSheetChrome';
import SheetHeaderAction from '../../../components/SheetHeaderAction';
import { APP_TEXT_SIZE, GLOBAL_FONT_SCALE_CAP } from '../../../theme/typeScale';

const STAGE_ONE_RATIO = 0.52;
const STAGE_TWO_RATIO = 0.8;
const SPRING = { stiffness: 320, damping: 29, mass: 1 } as const;

type SettingsOpeningProps = {
  visible: boolean;
  detents: number[];
  initialIndex: number;
  sheetHeight: SharedValue<number>;
  sheetTranslateY: SharedValue<number>;
  runUnmount: () => void;
  setMounted: (mounted: boolean) => void;
  setIndex: (index: number) => void;
};

function SettingsOpeningSpring({ visible, detents, initialIndex, sheetHeight, sheetTranslateY, setMounted, setIndex }: SettingsOpeningProps) {
  useMountEffect(() => {
    if (!visible) return;
    setMounted(true);
    setIndex(initialIndex);
    sheetTranslateY.value = 0;
    sheetHeight.value = withSpring(detents[initialIndex], SPRING);
  });
  return null;
}

function SettingsPanelOpening(props: SettingsOpeningProps) {
  const [previous, setPrevious] = useState({ ...props, generation: 0 });
  if (!Object.is(previous.visible, props.visible) || !Object.is(previous.detents, props.detents)
    || !Object.is(previous.initialIndex, props.initialIndex) || !Object.is(previous.sheetHeight, props.sheetHeight)
    || !Object.is(previous.sheetTranslateY, props.sheetTranslateY) || !Object.is(previous.runUnmount, props.runUnmount)) {
    setPrevious({ ...props, generation: previous.generation + 1 });
  }
  return <SettingsOpeningSpring key={previous.generation} {...props} />;
}

export type SettingsSheetPanelProps = {
  visible: boolean;
  onClose: () => void;
  onDismissComplete?: () => void;
  onBack?: () => void;
  action?: 'close' | 'commit';
  doneLabel?: string;
  onCommit?: () => void;
  title: string;
  /** Optional per-sheet heading size; other settings keep their existing type. */
  titleFontSize?: number;
  children: React.ReactNode;
  zIndex?: number;
  initialStage?: 0 | 1;
  stageOneRatio?: number;
  stageTwoRatio?: number;
  darkMaterial?: boolean;
  edgeToEdgeAtLast?: boolean;
  wrapContentInScrollView?: boolean;
  /** Use one full-width Stage 2 detent instead of the normal two-stage sheet. */
  singleStage?: boolean;
  home?: boolean;
  fitContent?: boolean;
  fillContent?: boolean;
  scrollResetKey?: string;
  backLabel?: string;
  background?: React.ReactNode;
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
  titleFontSize,
  children,
  zIndex = 90,
  initialStage = 0,
  stageOneRatio = STAGE_ONE_RATIO,
  stageTwoRatio = STAGE_TWO_RATIO,
  edgeToEdgeAtLast = true,
  wrapContentInScrollView = true,
  singleStage = false,
  home = false,
  fitContent = false,
  fillContent = false,
  scrollResetKey,
  backLabel = 'back',
  background,
}: SettingsSheetPanelProps) {
  const sheetChildren = React.Children.toArray(children);
  const rootContent = sheetChildren[0] ?? <View />;
  const nestedSheets = sheetChildren.slice(1);
  const { height } = useWindowDimensions();
  const { top: safeTop } = useSafeAreaInsets();
  const [headerHeight, setHeaderHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const homeLimit = Math.max(0, height - Math.max(50, safeTop - 4));
  const homeHeight = fitContent && contentHeight > 0 && headerHeight > 0
    ? Math.min(homeLimit, Math.max(232, Math.ceil(contentHeight + headerHeight)))
    : homeLimit;
  const detents = useMemo(
    () => home ? [homeHeight] : singleStage
      ? [Math.round(height * stageTwoRatio)]
      : [
        Math.round(height * stageOneRatio),
        Math.round(height * stageTwoRatio),
      ],
    [height, home, homeHeight, singleStage, stageOneRatio, stageTwoRatio],
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

  const opening = <SettingsPanelOpening visible={visible} detents={detents} initialIndex={initialIndex}
    sheetHeight={sheetHeight} sheetTranslateY={sheetTranslateY} runUnmount={runUnmount}
    setMounted={setMounted} setIndex={setIndex} />;

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

  if (!mounted && !visible) return <>{opening}</>;

  const header = (
    <View style={[styles.header, { paddingTop: SHEET_CORNER_ACTION_INSET - (home ? MAP_SHEET_COMPACT_GRABBER_HEIGHT : MAP_SHEET_GRABBER_HEIGHT) }]}>
      {onBack ? (
        <SheetHeaderAction
          action="back"
          onPress={onBack}
          accessibilityLabel={backLabel}
          testID={home ? "settings-child-back" : undefined}
        />
      ) : <View style={styles.headerActionSlot} />}
      <Text maxFontSizeMultiplier={GLOBAL_FONT_SCALE_CAP} style={[styles.title, titleFontSize != null && { fontSize: titleFontSize }]} numberOfLines={titleFontSize != null ? 2 : 1}>{title}</Text>
      <SheetHeaderAction
        testID={home || singleStage ? "settings-root-close" : "settings-child-back"}
        action={action}
        onPress={action === 'commit' ? () => onCommit?.() : onClose}
        accessibilityLabel={doneLabel}
        disabled={action === 'commit' && !onCommit}
      />
    </View>
  );

  return (
    <>
    {opening}
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityViewIsModal={visible}
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
        contentTopPadding={home ? 4 : 12}
        fillContent={fillContent}
        pinContentBelowHeader={home}
        scrollResetKey={scrollResetKey}
        onHeaderHeight={home ? setHeaderHeight : undefined}
        onContentHeight={home ? setContentHeight : undefined}
        compactGrabberSpacing={home}
        background={background}
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
    </>
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
    paddingHorizontal: SHEET_CORNER_ACTION_INSET,
    paddingBottom: 0,
  },
  headerActionSlot: {
    width: MAP_SHEET_ACTION_HIT_SIZE,
    height: MAP_SHEET_ACTION_HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: '#fff',
    fontSize: APP_TEXT_SIZE.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  nestedLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
});
