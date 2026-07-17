import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  /** Pause at the end before scrolling back (ms). Default 2000. */
  endPauseMs?: number;
  /** Pause at the start before scrolling (ms). Default 1000. */
  startPauseMs?: number;
};

/**
 * Single-line title that marquees only when the text overflows its viewport.
 * Scroll to end → pause → animate back to start. Reduce Motion → truncate.
 */
export default function OverflowMarquee({
  text,
  style,
  containerStyle,
  endPauseMs = 2000,
  startPauseMs = 1000,
}: Props) {
  const reduceMotion = useReducedMotion();
  const offset = useSharedValue(0);
  const [viewportW, setViewportW] = useState(0);
  const [textW, setTextW] = useState(0);

  const overflow = textW > viewportW + 1 && viewportW > 0 && textW > 0;
  const travel = Math.max(0, textW - viewportW);

  const runLoop = useCallback(() => {
    cancelAnimation(offset);
    offset.value = 0;
    if (reduceMotion || travel <= 0) return;

    // ~40 px/s, clamped so long titles still finish in a reasonable time.
    const duration = Math.min(12_000, Math.max(2_500, travel * 28));
    const backDuration = Math.min(800, Math.max(400, duration * 0.2));

    const loop = () => {
      offset.value = withSequence(
        withDelay(
          startPauseMs,
          withTiming(-travel, {
            duration,
            easing: Easing.linear,
            reduceMotion: ReduceMotion.System,
          }),
        ),
        withDelay(
          endPauseMs,
          withTiming(
            0,
            {
              duration: backDuration,
              easing: Easing.out(Easing.cubic),
              reduceMotion: ReduceMotion.System,
            },
            (finished) => {
              if (finished) loop();
            },
          ),
        ),
      );
    };
    loop();
  }, [endPauseMs, offset, reduceMotion, startPauseMs, travel]);

  useEffect(() => {
    runLoop();
    return () => cancelAnimation(offset);
  }, [offset, runLoop, text]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  if (reduceMotion || !overflow) {
    return (
      <View
        style={[styles.clip, containerStyle]}
        onLayout={(e) => setViewportW(e.nativeEvent.layout.width)}
      >
        <Text
          style={style}
          numberOfLines={1}
          ellipsizeMode="tail"
          onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
        >
          {text}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.clip, containerStyle]}
      onLayout={(e) => setViewportW(e.nativeEvent.layout.width)}
    >
      <Animated.View style={[{ flexDirection: 'row' }, animatedStyle]}>
        <Text
          style={style}
          numberOfLines={1}
          onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
        >
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
    flex: 1,
    minWidth: 0,
  },
});
