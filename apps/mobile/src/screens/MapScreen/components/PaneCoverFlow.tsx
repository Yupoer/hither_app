/**
 * Four-pane CoverFlow selector (members / route / tools / store).
 * Swipe-only; exclusive horizontal vs Bottom Sheet vertical via failOffsetY.
 * Reanimated + Gesture Handler + Haptics only — no carousel package.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { glass } from '../../../glass';
import { GLOBAL_FONT_SCALE_CAP } from '../../../theme/typeScale';
import { useFontLayout } from '../../../a11y/useFontScaleBucket';
import {
  COVERFLOW_ACTIVE_OFFSET_X,
  COVERFLOW_FAIL_OFFSET_Y,
  coverFlowHapticSteps,
  coverFlowSnapIndex,
} from '../../../store/sheetPane';
import type { SheetPaneKey } from '../../../store/types';
import { selectionTick } from '../../../utils/haptics';
import { useTranslation } from '../../../i18n';

export interface PaneCoverFlowOption {
  key: SheetPaneKey;
  label: string;
}

interface PaneCoverFlowProps {
  options: PaneCoverFlowOption[];
  value: SheetPaneKey;
  onChange: (key: SheetPaneKey) => void;
  accent: string;
}

/**
 * Geometry so all 4 pane cards stay inside the track for every selected index.
 * cardW + 3*step <= trackW  ⇒  max |offset| 3 stays on-screen.
 * cardW = w/k, step = cardW*r  ⇒  1/k + 3*(r/k) <= 1  ⇒  k >= 1+3r
 * Use r≈0.52, k≈3.0 so extreme store card is still partially/fully visible.
 */
export const COVERFLOW_CARD_DIVISOR = 3.05;
export const COVERFLOW_STEP_RATIO = 0.52;

/** Pure layout helper for tests: left edge of card index relative to track [0,w]. */
export function coverFlowCardLeftEdge(args: {
  trackW: number;
  cardIndex: number;
  centerIndex: number;
  cardDivisor?: number;
  stepRatio?: number;
}): number {
  const w = args.trackW;
  const cardW = w / (args.cardDivisor ?? COVERFLOW_CARD_DIVISOR);
  const step = cardW * (args.stepRatio ?? COVERFLOW_STEP_RATIO);
  const offset = args.cardIndex - args.centerIndex;
  // Cards are centered on track mid; left edge = mid + offset*step - cardW/2
  return w / 2 + offset * step - cardW / 2;
}

const SPRING = { stiffness: 320, damping: 28, mass: 0.9 } as const;

export const PaneCoverFlow = React.memo(function PaneCoverFlow({
  options,
  value,
  onChange,
  accent,
}: PaneCoverFlowProps) {
  const { t } = useTranslation();
  const { scale, boldText } = useFontLayout();
  const reducedMotion = useReducedMotion();
  const styles = useMemo(() => makeStyles(scale, boldText), [scale, boldText]);
  const n = options.length;
  const selectedIndex = Math.max(0, options.findIndex((o) => o.key === value));
  const indexRef = useRef(selectedIndex);
  indexRef.current = selectedIndex;

  const trackW = useSharedValue(0);
  const indexSV = useSharedValue(selectedIndex);
  const dragX = useSharedValue(0);
  /** Worklet flag: onEnd ran for this gesture; finalize only clears drag if not. */
  const didEndSV = useSharedValue(0);

  useEffect(() => {
    indexSV.value = reducedMotion
      ? selectedIndex
      : withTiming(selectedIndex, { duration: 180 });
    dragX.value = 0;
  }, [selectedIndex, indexSV, dragX, reducedMotion]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    trackW.value = e.nativeEvent.layout.width;
  }, [trackW]);

  const commitIndex = useCallback((next: number) => {
    const start = indexRef.current;
    const clamped = Math.max(0, Math.min(n - 1, next));
    if (clamped === start) return;
    const key = options[clamped]?.key;
    if (!key) return;
    // One selection haptic per index crossed (Ticket 08).
    const steps = coverFlowHapticSteps(start, clamped);
    for (let i = 0; i < steps; i += 1) selectionTick();
    onChange(key);
  }, [n, onChange, options]);

  const finishGesture = useCallback((translationX: number, velocityX: number) => {
    const start = indexRef.current;
    const next = coverFlowSnapIndex({
      currentIndex: start,
      translationX,
      velocityX,
      itemCount: n,
    });
    dragX.value = 0;
    if (reducedMotion) {
      indexSV.value = next;
    } else {
      indexSV.value = withSpring(next, SPRING);
    }
    if (next !== start) {
      commitIndex(next);
    }
  }, [commitIndex, dragX, indexSV, n, reducedMotion]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Exclusive horizontal: activate on X, fail on dominant Y (sheet wins vertical).
        .activeOffsetX([-COVERFLOW_ACTIVE_OFFSET_X, COVERFLOW_ACTIVE_OFFSET_X])
        .failOffsetY([-COVERFLOW_FAIL_OFFSET_Y, COVERFLOW_FAIL_OFFSET_Y])
        .onBegin(() => {
          'worklet';
          didEndSV.value = 0;
          dragX.value = 0;
        })
        .onUpdate((e) => {
          'worklet';
          dragX.value = e.translationX;
        })
        .onEnd((e) => {
          'worklet';
          didEndSV.value = 1;
          runOnJS(finishGesture)(e.translationX, e.velocityX);
        })
        .onFinalize(() => {
          'worklet';
          // Cancel / fail without onEnd: snap visual drag back to stable index.
          if (didEndSV.value === 0) {
            dragX.value = 0;
          }
        }),
    [didEndSV, dragX, finishGesture],
  );

  const a11yLabel = options.map((o) => o.label).join(', ');
  const selectedLabel = options[selectedIndex]?.label ?? '';

  const onA11yAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      const name = event.nativeEvent.actionName;
      if (name === 'increment') {
        commitIndex(selectedIndex + 1);
      } else if (name === 'decrement') {
        commitIndex(selectedIndex - 1);
      }
    },
    [commitIndex, selectedIndex],
  );

  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.wrap}
        onLayout={onLayout}
        testID="pane-coverflow"
        accessibilityRole="adjustable"
        accessibilityLabel={a11yLabel}
        accessibilityValue={{
          text: selectedLabel,
          now: selectedIndex,
          min: 0,
          max: Math.max(0, n - 1),
        }}
        accessibilityActions={[
          { name: 'increment', label: t('map.coverFlowNext') },
          { name: 'decrement', label: t('map.coverFlowPrev') },
        ]}
        onAccessibilityAction={onA11yAction}
      >
        {options.map((opt, i) => (
          <CoverCard
            key={opt.key}
            index={i}
            label={opt.label}
            accent={accent}
            styles={styles}
            indexSV={indexSV}
            dragX={dragX}
            trackW={trackW}
            itemCount={n}
            reducedMotion={!!reducedMotion}
            selected={i === selectedIndex}
          />
        ))}
      </View>
    </GestureDetector>
  );
});

function CoverCard({
  index,
  label,
  accent,
  styles,
  indexSV,
  dragX,
  trackW,
  itemCount,
  reducedMotion,
  selected,
}: {
  index: number;
  label: string;
  accent: string;
  styles: ReturnType<typeof makeStyles>;
  indexSV: SharedValue<number>;
  dragX: SharedValue<number>;
  trackW: SharedValue<number>;
  itemCount: number;
  reducedMotion: boolean;
  selected: boolean;
}) {
  const animStyle = useAnimatedStyle(() => {
    const w = trackW.value > 0 ? trackW.value : 1;
    // Ticket 08: all four cards remain inside the track for every center index.
    const cardW = w / COVERFLOW_CARD_DIVISOR;
    const step = cardW * COVERFLOW_STEP_RATIO;
    // Finger right → show previous (index decreases as dragX grows).
    const center = indexSV.value - dragX.value / Math.max(step, 1);
    const offset = index - center;
    const abs = Math.abs(offset);
    const motionScale = reducedMotion ? 0.35 : 1;
    const translateX = offset * step * (reducedMotion ? 0.55 : 1);
    const scale = interpolate(
      abs,
      [0, 1, 2, 3],
      [1, 0.92 - 0.04 * (1 - motionScale), 0.86, 0.8],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      abs,
      [0, 1, 2, 3],
      [1, 0.92, 0.78, 0.68],
      Extrapolation.CLAMP,
    );
    const zIndex = Math.round((itemCount - abs) * 10);
    const elev = interpolate(abs, [0, 1, 2], [8, 3, 0], Extrapolation.CLAMP);

    return {
      width: cardW,
      transform: [
        { translateX },
        { scale },
      ],
      opacity,
      zIndex,
      elevation: elev,
      shadowOpacity: reducedMotion
        ? 0.12
        : interpolate(abs, [0, 1.5], [0.35, 0.08], Extrapolation.CLAMP),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.card,
        selected && { borderColor: accent },
        animStyle,
      ]}
      testID={`pane-coverflow-card-${index}`}
    >
      <Text
        style={[styles.cardText, selected && styles.cardTextSelected]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        maxFontSizeMultiplier={GLOBAL_FONT_SCALE_CAP}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

const makeStyles = (scale: number, boldText: boolean) => {
  const s = (n: number, min = 0) => Math.max(min, Math.round(n * scale));
  return StyleSheet.create({
    wrap: {
      width: '100%',
      height: s(52, 44),
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: s(6, 4),
      overflow: 'visible',
    },
    card: {
      position: 'absolute',
      minHeight: s(40, 36),
      borderRadius: s(12, 10),
      paddingHorizontal: s(10, 8),
      paddingVertical: s(10, 8),
      backgroundColor: 'rgba(255,255,255,0.12)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.14)',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
    },
    cardText: {
      fontSize: s(boldText ? 14 : 16, 13),
      fontWeight: boldText ? '600' : '700',
      color: glass.textSecondary,
      textAlign: 'center',
    },
    cardTextSelected: {
      color: '#fff',
    },
  });
};
