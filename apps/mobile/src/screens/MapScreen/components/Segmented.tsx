import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { glass } from '../../../glass';

interface SegmentedProps {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  accent: string;
  /** Options shown greyed-out/locked; tapping them calls `onDisabledPress` instead of `onChange`. */
  disabledKeys?: string[];
  onDisabledPress?: (key: string) => void;
}

const segStyles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: glass.fill,
    borderRadius: 13,
    padding: 4,
    marginBottom: 4,
  },
  seg: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  highlight: {
    position: 'absolute',
    left: 4,
    top: 4,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  segLocked: { opacity: 0.4 },
  segText: { fontSize: 15, fontWeight: '600', color: glass.textSecondary },
});

export function Segmented({
  options,
  value,
  onChange,
  accent,
  disabledKeys,
  onDisabledPress,
}: SegmentedProps) {
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

  return (
    <View style={segStyles.track} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
      {segW > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[segStyles.highlight, { width: segW }, highlightStyle]}
        />
      ) : null}
      {options.map((o) => {
        const active = o.key === localValue;
        const locked = !!disabledKeys?.includes(o.key);
        return (
          <Pressable
            key={o.key}
            style={({ pressed }) => [
              segStyles.seg,
              locked && segStyles.segLocked,
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
            <Text style={[segStyles.segText, active && { color: '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
