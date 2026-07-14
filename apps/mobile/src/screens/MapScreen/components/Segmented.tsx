import React, { useState, useEffect, useMemo } from 'react';
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
  const { scale } = useFontLayout();
  const styles = useMemo(() => makeSegStyles(scale), [scale]);
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const SEG_PAD = 4;
  const SEG_GAP = 6;
  const [trackW, setTrackW] = useState(0);
  const n = options.length;
  const activeIdx = Math.max(0, options.findIndex((o) => o.key === localValue));
  const segW = trackW > 0 ? (trackW - SEG_PAD * 2 - SEG_GAP * (n - 1)) / n : 0;
  const tx = useSharedValue(0);

  useEffect(() => {
    // Slide the highlight to the active segment — smooth easing beats a hard cut.
    tx.value = withTiming(activeIdx * (segW + SEG_GAP), {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [activeIdx, segW, tx]);

  const highlightStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const segMinH = Math.max(36, Math.round(38 * scale));

  return (
    <View style={styles.track} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
      {segW > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.highlight, { width: segW, minHeight: segMinH }, highlightStyle]}
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
              { minHeight: segMinH },
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
              numberOfLines={2}
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

const makeSegStyles = (scale: number) => {
  const s = (n: number, min = 0) => Math.max(min, Math.round(n * scale));
  return StyleSheet.create({
    track: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: s(6, 4),
      backgroundColor: glass.fill,
      borderRadius: s(13, 10),
      padding: s(4, 3),
      marginBottom: s(4, 2),
    },
    seg: {
      flex: 1,
      minWidth: 56,
      borderRadius: s(10, 8),
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: s(4, 2),
      paddingVertical: s(8, 6),
      zIndex: 1,
    },
    highlight: {
      position: 'absolute',
      left: 4,
      top: 4,
      borderRadius: s(10, 8),
      backgroundColor: 'rgba(255,255,255,0.16)',
    },
    segLocked: { opacity: 0.4 },
    segText: {
      fontSize: s(16, 15),
      fontWeight: '700',
      color: glass.textSecondary,
      textAlign: 'center',
    },
  });
};
