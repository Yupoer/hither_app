import React, { useCallback, useEffect, useRef, type ComponentProps } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

// Adapted from https://github.com/Subhan-code/Amicro--Micro-transitions-
// MIT licensed by Syed Subhan. This native version uses the app's existing
// Reanimated runtime instead of the web-only motion/react implementation.

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export type AmicroButtonMode = 'morph' | 'rotate';

export interface AmicroButtonProps {
  icon: IoniconName;
  activeIcon?: IoniconName;
  active?: boolean;
  activeOnPress?: boolean;
  resetAfterComplete?: boolean;
  mode?: AmicroButtonMode;
  color: string;
  activeColor?: string;
  size?: number;
  disabled?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onAnimationComplete?: () => void;
}

const PRESS_ANIMATION_MS = 220;

export function AmicroButton({
  icon,
  activeIcon = icon,
  active = false,
  activeOnPress,
  resetAfterComplete = true,
  mode = 'morph',
  color,
  activeColor = color,
  size = 44,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
  onPress,
  onAnimationComplete,
}: AmicroButtonProps) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(active ? 1 : 0);
  const busyRef = useRef(false);

  const finish = useCallback(() => {
    busyRef.current = false;
    onAnimationComplete?.();
    if (resetAfterComplete) {
      progress.value = withTiming(active ? 1 : 0, { duration: 100 });
    }
  }, [active, onAnimationComplete, progress, resetAfterComplete]);

  useEffect(() => {
    if (busyRef.current) return;
    progress.value = withTiming(active ? 1 : 0, { duration: reducedMotion ? 0 : 100 });
  }, [active, progress, reducedMotion]);

  const handlePress = useCallback(() => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    onPress?.();
    if (reducedMotion) {
      finish();
      return;
    }
    const target = (activeOnPress ?? true) ? 1 : 0;
    progress.value = withTiming(target, { duration: PRESS_ANIMATION_MS }, (finished) => {
      if (finished) runOnJS(finish)();
    });
  }, [activeOnPress, disabled, finish, onPress, progress, reducedMotion, resetAfterComplete]);

  const currentStyle = useAnimatedStyle(() => {
    if (mode === 'rotate') {
      return {
        opacity: 1,
        transform: [{ rotate: `${progress.value * 180}deg` }],
      };
    }
    return {
      opacity: interpolate(progress.value, [0, 0.5, 1], [1, 0, 0]),
      transform: [{ scale: interpolate(progress.value, [0, 0.5, 1], [1, 0.5, 0.5]) }],
    };
  });

  const activeStyle = useAnimatedStyle(() => ({
    opacity: mode === 'rotate'
      ? 0
      : interpolate(progress.value, [0, 0.5, 1], [0, 0, 1]),
    transform: [{ scale: mode === 'rotate' ? 1 : interpolate(progress.value, [0, 0.5, 1], [0.5, 0.5, 1]) }],
  }));

  return (
    <Pressable
      style={[styles.pressable, { width: size, height: size }, style]}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      testID={testID}
    >
      <View style={styles.iconSlot}>
        <Animated.View style={[styles.icon, currentStyle]}>
          <Ionicons name={icon} size={size >= 44 ? 20 : 18} color={color} />
        </Animated.View>
        {mode === 'morph' ? (
          <Animated.View style={[styles.icon, activeStyle]}>
            <Ionicons name={activeIcon} size={size >= 44 ? 20 : 18} color={activeColor} />
          </Animated.View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function BouncingDots({ color }: { color: string }) {
  const reducedMotion = useReducedMotion();
  const first = useSharedValue(0);
  const second = useSharedValue(0);
  const third = useSharedValue(0);

  useEffect(() => {
    const values = [first, second, third];
    values.forEach((value, index) => {
      value.value = reducedMotion
        ? 0
        : withDelay(
            index * 100,
            withRepeat(
              withSequence(
                withTiming(-20, { duration: 400 }),
                withTiming(0, { duration: 400 }),
              ),
              -1,
              false,
            ),
          );
    });
    return () => values.forEach((value) => cancelAnimation(value));
  }, [first, reducedMotion, second, third]);

  const firstStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: first.value }, { scaleY: interpolate(first.value, [-20, 0], [1.1, 0.8]) }],
  }));
  const secondStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: second.value }, { scaleY: interpolate(second.value, [-20, 0], [1.1, 0.8]) }],
  }));
  const thirdStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: third.value }, { scaleY: interpolate(third.value, [-20, 0], [1.1, 0.8]) }],
  }));

  return (
    <View style={styles.dots} accessibilityLabel="Loading">
      <Animated.View style={[styles.dot, { left: 8, backgroundColor: color }, firstStyle]} />
      <Animated.View style={[styles.dot, { left: 26, backgroundColor: color }, secondStyle]} />
      <Animated.View style={[styles.dot, { left: 44, backgroundColor: color }, thirdStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSlot: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: {
    width: 64,
    height: 48,
    position: 'relative',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    position: 'absolute',
    bottom: 8,
  },
});
