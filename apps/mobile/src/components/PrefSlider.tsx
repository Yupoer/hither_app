import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type Props = {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Accent for fill + thumb. */
  accent: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * OTA-safe continuous slider (no native Slider module).
 * Track tap + drag; value rounded to nearest integer.
 */
export default function PrefSlider({
  value,
  min,
  max,
  onChange,
  accent,
  style,
  accessibilityLabel,
}: Props) {
  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const onChangeRef = useRef(onChange);
  minRef.current = min;
  maxRef.current = max;
  onChangeRef.current = onChange;

  const span = Math.max(1, max - min);
  const ratio = Math.min(1, Math.max(0, (value - min) / span));

  const valueFromX = useCallback((x: number) => {
    const w = trackWRef.current;
    if (w <= 0) return minRef.current;
    const r = Math.min(1, Math.max(0, x / w));
    const raw = minRef.current + r * (maxRef.current - minRef.current);
    return Math.round(raw);
  }, []);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          onChangeRef.current(valueFromX(e.nativeEvent.locationX));
        },
        onPanResponderMove: (e) => {
          onChangeRef.current(valueFromX(e.nativeEvent.locationX));
        },
      }),
    [valueFromX],
  );

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    trackWRef.current = w;
    if (w > 0) setTrackW(w);
  };

  const thumbLeft = trackW > 0 ? ratio * trackW : 0;

  return (
    <View
      style={[styles.wrap, style]}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      {...pan.panHandlers}
      onLayout={onTrackLayout}
    >
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${ratio * 100}%`, backgroundColor: accent },
          ]}
        />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.thumb,
          {
            left: Math.max(0, thumbLeft - 10),
            borderColor: accent,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 36,
    justifyContent: 'center',
    width: '100%',
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,120,128,0.32)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 2,
    top: 8,
  },
});
