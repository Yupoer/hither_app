import React, { useState } from 'react';
import { Pressable, StyleSheet, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type MotionPressableProps = React.ComponentPropsWithRef<typeof Pressable> & { motion?: 'scale' | 'fade' | 'depth' };

export default function MotionPressable({
  style, onPressIn, onPressOut, motion = 'scale', ...props
}: MotionPressableProps) {
  const reduceMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const feedback = useSharedValue(0);
  const resolved = typeof style === 'function' ? style({ pressed }) : style;
  const base = StyleSheet.flatten(resolved);
  const opacity = typeof base?.opacity === 'number' ? base.opacity : 1;
  const scale = motion === 'scale' && !reduceMotion && !base?.transform;
  const disabled = props.disabled;
  const animated = useAnimatedStyle(() => {
    const strength = disabled ? 0 : feedback.value;
    if (motion === 'depth') return {
      opacity: opacity * (1 - strength * 0.06),
      transform: [{ translateY: reduceMotion ? 0 : strength * 4 }],
      boxShadow: [{ offsetX: 0, offsetY: 4 * (1 - strength), blurRadius: 0, color: 'rgba(0,0,0,0.28)' }],
    };
    return scale
      ? { opacity: opacity * (1 - strength * 0.08), transform: [{ scale: 1 - strength * 0.018 }] }
      : { opacity: opacity * (1 - strength * 0.14) };
  });
  function handlePressIn(event: GestureResponderEvent) {
    if (typeof style === 'function') setPressed(true);
    feedback.value = withTiming(1, { duration: reduceMotion ? 0 : 100 });
    onPressIn?.(event);
  }
  function handlePressOut(event: GestureResponderEvent) {
    if (typeof style === 'function') setPressed(false);
    feedback.value = withTiming(0, { duration: reduceMotion ? 0 : 160 });
    onPressOut?.(event);
  }
  return <AnimatedPressable {...props} style={[resolved, animated]} onPressIn={handlePressIn} onPressOut={handlePressOut} />;
}
