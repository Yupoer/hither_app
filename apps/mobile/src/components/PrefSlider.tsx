import React, { useCallback, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Slider from '@react-native-community/slider';
import { selectionTick } from '../utils/haptics';

type Props = {
  value: number;
  /** Discrete detents (arrival radius). Prefer over min/max when provided. */
  values?: readonly number[];
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  /** Accent for fill + thumb. */
  accent: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * Stepped or continuous preference slider backed by the native community Slider.
 * When `values` is set, maps a uniform index to non-uniform meter options and
 * fires one selection haptic per detent change.
 */
export default function PrefSlider({
  value,
  values,
  min = 0,
  max = 1,
  onChange,
  accent,
  style,
  accessibilityLabel,
}: Props) {
  const lastIndexRef = useRef<number | null>(null);

  const useDetents = Array.isArray(values) && values.length > 0;
  const selectedIndex = useDetents
    ? Math.max(0, values.findIndex((v) => v === value))
    : 0;
  // If value is not an exact option, snap display index to nearest.
  const displayIndex = useDetents
    ? selectedIndex >= 0
      ? selectedIndex
      : values.reduce((best, option, index) => {
          const bestDist = Math.abs(values[best]! - value);
          const dist = Math.abs(option - value);
          return dist < bestDist || (dist === bestDist && option < values[best]!)
            ? index
            : best;
        }, 0)
    : value;

  const handleIndexChange = useCallback(
    (raw: number) => {
      if (useDetents && values) {
        const index = Math.round(raw);
        if (index === lastIndexRef.current) return;
        if (index < 0 || index >= values.length) return;
        lastIndexRef.current = index;
        selectionTick();
        onChange(values[index]!);
        return;
      }
      const next = Math.round(raw);
      if (next === lastIndexRef.current) return;
      lastIndexRef.current = next;
      selectionTick();
      onChange(next);
    },
    [onChange, useDetents, values],
  );

  return (
    <View style={[styles.wrap, style]} accessibilityLabel={accessibilityLabel}>
      <Slider
        style={styles.slider}
        minimumValue={useDetents ? 0 : min}
        maximumValue={useDetents ? values!.length - 1 : max}
        step={1}
        value={displayIndex}
        minimumTrackTintColor={accent}
        maximumTrackTintColor="rgba(120,120,128,0.32)"
        onValueChange={handleIndexChange}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    justifyContent: 'center',
  },
  slider: {
    width: '100%',
    height: 40,
  },
});
