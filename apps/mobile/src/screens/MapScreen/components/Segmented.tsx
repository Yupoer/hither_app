import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { glass } from '../../../glass';
import { GLOBAL_FONT_SCALE_CAP } from '../../../theme/typeScale';
import { useFontLayout } from '../../../a11y/useFontScaleBucket';

interface SegmentedProps {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  accent: string;
  /** Options shown greyed-out/locked; tapping them calls `onDisabledPress` instead of `onChange`. */
  disabledKeys?: string[];
  onDisabledPress?: (key: string) => void;
}

export function Segmented({
  options,
  value,
  onChange,
  accent,
  disabledKeys,
  onDisabledPress,
}: SegmentedProps) {
  const { scale, boldText } = useFontLayout();
  const dense = options.length >= 5 || boldText || scale >= 1.15;
  const styles = useMemo(
    () => makeSegStyles(scale, dense, boldText),
    [scale, dense, boldText],
  );
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const SEG_PAD = dense ? 3 : 4;
  const SEG_GAP = dense ? 4 : 6;
  const [trackW, setTrackW] = useState(0);
  const n = options.length;
  const activeIdx = Math.max(0, options.findIndex((o) => o.key === localValue));
  // Equal-width segments on one row — no flexWrap, so highlight stays aligned
  // even with 5 options + Bold Text wider glyphs.
  const segW = trackW > 0 ? (trackW - SEG_PAD * 2 - SEG_GAP * (n - 1)) / n : 0;
  const tx = useSharedValue(0);
  // Snap on first measure / width-only changes so hidden panes (height:0 →
  // visible) don't "slide" the pill when the user only switched tabs.
  // Also snap whenever width was zero and becomes positive (tools pane reveal).
  const measuredRef = useRef(false);
  const prevIdxRef = useRef(activeIdx);
  const prevSegWRef = useRef(0);

  useEffect(() => {
    if (segW <= 0) {
      prevSegWRef.current = 0;
      return;
    }
    const next = activeIdx * (segW + SEG_GAP);
    const idxChanged = prevIdxRef.current !== activeIdx;
    const widthAppeared = prevSegWRef.current <= 0;
    prevIdxRef.current = activeIdx;
    prevSegWRef.current = segW;
    // Animate only when the user changed the selected segment on a stable track.
    // Never animate on first measure, remount, pane unhide (0→width), or pure resize.
    if (measuredRef.current && idxChanged && !widthAppeared) {
      tx.value = withTiming(next, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      tx.value = next;
      measuredRef.current = true;
    }
  }, [activeIdx, segW, SEG_GAP, tx]);

  const highlightStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const segMinH = Math.max(36, Math.round((dense ? 34 : 38) * scale));

  return (
    <View
      style={[styles.track, { padding: SEG_PAD, gap: SEG_GAP }]}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
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
            accessibilityState={{ selected: active, disabled: locked }}
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
}

const makeSegStyles = (scale: number, dense: boolean, boldText: boolean) => {
  const s = (n: number, min = 0) => Math.max(min, Math.round(n * scale));
  // Bold Text widens glyphs; drop type a step so 5-up labels still fit one line.
  const labelBase = dense ? (boldText ? 12 : 13) : boldText ? 14 : 16;
  return StyleSheet.create({
    track: {
      flexDirection: 'row',
      flexWrap: 'nowrap',
      backgroundColor: glass.fill,
      borderRadius: s(13, 10),
      marginBottom: s(4, 2),
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
