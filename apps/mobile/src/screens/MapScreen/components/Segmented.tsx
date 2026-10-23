import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { View, Text, Pressable, StyleSheet, ScrollView, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { glass } from '../../../glass';
import { GLOBAL_FONT_SCALE_CAP } from '../../../theme/typeScale';
import { useFontLayout } from '../../../a11y/useFontScaleBucket';
import { tabScrollOffsetForSelection } from '../../../store/sheetPane';

type SegmentMotionProps = {
  activeIdx: number;
  segW: number;
  gap: number;
  tx: SharedValue<number>;
  scrollSelectedIntoView: (idx: number, animated: boolean) => void;
  measuredRef: React.RefObject<boolean>;
  prevIdxRef: React.RefObject<number>;
  prevSegWRef: React.RefObject<number>;
};

function SelectedSegmentMotion({ activeIdx, segW, gap, tx, scrollSelectedIntoView, measuredRef, prevIdxRef, prevSegWRef }: SegmentMotionProps) {
  const issued = useRef(false);
  useMountEffect(() => {
    // Strict replay must not replace this committed animation command with a snap.
    if (issued.current) return;
    issued.current = true;
    if (segW <= 0) {
      prevSegWRef.current = 0;
      return;
    }
    const next = activeIdx * (segW + gap);
    const idxChanged = prevIdxRef.current !== activeIdx;
    const widthAppeared = prevSegWRef.current <= 0;
    prevIdxRef.current = activeIdx;
    prevSegWRef.current = segW;
    // Resizes and pane reveals snap; only selection changes animate.
    if (measuredRef.current && idxChanged && !widthAppeared) {
      tx.value = withTiming(next, { duration: 220, easing: Easing.out(Easing.cubic) });
      scrollSelectedIntoView(activeIdx, true);
    } else {
      tx.value = next;
      measuredRef.current = true;
      if (widthAppeared || idxChanged) scrollSelectedIntoView(activeIdx, false);
    }
  });
  return null;
}

function SegmentSelectionMotion(props: SegmentMotionProps) {
  const [previous, setPrevious] = useState({ ...props, generation: 0 });
  if (!Object.is(previous.activeIdx, props.activeIdx) || !Object.is(previous.segW, props.segW)
    || !Object.is(previous.gap, props.gap) || !Object.is(previous.tx, props.tx)
    || !Object.is(previous.scrollSelectedIntoView, props.scrollSelectedIntoView)) {
    setPrevious({ ...props, generation: previous.generation + 1 });
  }
  return <SelectedSegmentMotion key={previous.generation} {...props} />;
}

interface SegmentedProps {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  accent: string;
  /** Options shown greyed-out/locked; tapping them calls `onDisabledPress` instead of `onChange`. */
  disabledKeys?: string[];
  onDisabledPress?: (key: string) => void;
  /**
   * Opt-in transparent track so a parent Liquid Glass surface can show through.
   * Default keeps the shared fill used by Settings and other segmented controls.
   */
  unstyledTrack?: boolean;
  /**
   * When set (e.g. 3), only this many equal-width tabs fit the viewport;
   * overflow options are reached by horizontal scroll of the tab bar.
   */
  viewportCount?: number;
}

export const Segmented = React.memo(function Segmented({
  options,
  value,
  onChange,
  accent,
  disabledKeys,
  onDisabledPress,
  unstyledTrack = false,
  viewportCount,
}: SegmentedProps) {
  const { scale, boldText } = useFontLayout();
  const dense = options.length >= 5 || boldText || scale >= 1.15 || (viewportCount != null && options.length > 3);
  const styles = useMemo(
    () => makeSegStyles(scale, dense, boldText),
    [scale, dense, boldText],
  );
  const [localValue, setLocalValue] = useState(value);

  const [previousValue, setPreviousValue] = useState(value);
  if (!Object.is(previousValue, value)) {
    setPreviousValue(value);
    setLocalValue(value);
  }

  const SEG_PAD = dense ? 3 : 4;
  const SEG_GAP = dense ? 4 : 6;
  const [trackW, setTrackW] = useState(0);
  const n = options.length;
  const activeIdx = Math.max(0, options.findIndex((o) => o.key === localValue));
  const useViewport = typeof viewportCount === 'number' && viewportCount > 0 && n > viewportCount;
  const slots = useViewport ? viewportCount : n;
  // Equal-width segments — viewport mode sizes each tab to 1/viewport of the visible track.
  const segW = trackW > 0 && slots > 0
    ? (trackW - SEG_PAD * 2 - SEG_GAP * (slots - 1)) / slots
    : 0;
  const contentW = useViewport && segW > 0
    ? SEG_PAD * 2 + segW * n + SEG_GAP * Math.max(0, n - 1)
    : trackW;
  const tx = useSharedValue(0);
  // Snap on first measure / width-only changes so hidden panes (height:0 →
  // visible) don't "slide" the pill when the user only switched tabs.
  // Also snap whenever width was zero and becomes positive (tools pane reveal).
  const measuredRef = useRef(false);
  const prevIdxRef = useRef(activeIdx);
  const prevSegWRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const scrollXRef = useRef(0);

  const scrollSelectedIntoView = useCallback((idx: number, animated: boolean) => {
    if (!useViewport || segW <= 0) return;
    const offset = tabScrollOffsetForSelection({
      selectedIndex: idx,
      tabWidth: segW + SEG_GAP,
      viewportCount: viewportCount!,
      totalCount: n,
    });
    scrollRef.current?.scrollTo({ x: offset, animated });
  }, [useViewport, segW, SEG_GAP, viewportCount, n]);

  const selectionMotion = <SegmentSelectionMotion activeIdx={activeIdx} segW={segW} gap={SEG_GAP} tx={tx}
    scrollSelectedIntoView={scrollSelectedIntoView} measuredRef={measuredRef} prevIdxRef={prevIdxRef} prevSegWRef={prevSegWRef} />;

  const highlightStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const segMinH = Math.max(36, Math.round((dense ? 34 : 38) * scale));

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollXRef.current = e.nativeEvent.contentOffset.x;
  };

  const row = (
    <View
      style={[
        styles.track,
        unstyledTrack && styles.trackUnstyled,
        { padding: SEG_PAD, gap: SEG_GAP },
        useViewport && { width: contentW },
      ]}
      onLayout={useViewport ? undefined : (e) => setTrackW(e.nativeEvent.layout.width)}
    >
      {segW > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.highlight,
            {
              width: segW,
              minHeight: segMinH,
              left: SEG_PAD,
              top: SEG_PAD,
            },
            highlightStyle,
          ]}
        />
      ) : null}
      {options.map((o) => {
        const active = o.key === localValue;
        const locked = !!disabledKeys?.includes(o.key);
        return (
          <Pressable
            key={o.key}
            style={({ pressed }) => [
              styles.seg,
              { minHeight: segMinH, width: segW > 0 ? segW : undefined },
              locked && styles.segLocked,
              pressed && { opacity: 0.6 },
            ]}
            onPress={() => {
              if (locked) {
                onDisabledPress?.(o.key);
              } else {
                setLocalValue(o.key);
                onChange(o.key);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: active, disabled: locked }}
            testID={`segmented-tab-${o.key}`}
          >
            <Text
              style={[styles.segText, active && { color: '#fff' }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              maxFontSizeMultiplier={GLOBAL_FONT_SCALE_CAP}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (useViewport) {
    return (
      <>
      {selectionMotion}
      <View
        style={styles.viewportWrap}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
        testID="segmented-viewport"
      >
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          bounces={false}
          decelerationRate="fast"
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
        >
          {row}
        </ScrollView>
      </View>
      </>
    );
  }

  return <>{selectionMotion}{row}</>;
});

const makeSegStyles = (scale: number, dense: boolean, boldText: boolean) => {
  const s = (n: number, min = 0) => Math.max(min, Math.round(n * scale));
  // Bold Text widens glyphs; drop type a step so 5-up labels still fit one line.
  const labelBase = dense ? (boldText ? 12 : 13) : boldText ? 14 : 16;
  return StyleSheet.create({
    viewportWrap: {
      width: '100%',
    },
    track: {
      flexDirection: 'row',
      flexWrap: 'nowrap',
      backgroundColor: glass.fill,
      borderRadius: s(13, 10),
      marginBottom: s(4, 2),
    },
    trackUnstyled: {
      backgroundColor: 'transparent',
    },
    seg: {
      borderRadius: s(10, 8),
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: dense ? s(2, 1) : s(4, 2),
      paddingVertical: dense ? s(6, 5) : s(8, 6),
      zIndex: 1,
    },
    highlight: {
      position: 'absolute',
      borderRadius: s(10, 8),
      backgroundColor: 'rgba(255,255,255,0.16)',
    },
    segLocked: { opacity: 0.4 },
    segText: {
      fontSize: s(labelBase, dense ? 11 : 13),
      // Slightly lighter weight under system Bold Text so OS bold + 700
      // doesn't double-thicken into unreadable blobs on short labels.
      fontWeight: boldText ? '600' : '700',
      color: glass.textSecondary,
      textAlign: 'center',
    },
  });
};
