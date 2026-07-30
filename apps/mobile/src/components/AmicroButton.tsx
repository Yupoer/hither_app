import React, { useCallback, useEffect, useRef, type ComponentProps } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
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
  label?: string;
  /** Defaults to `color` when omitted. */
  labelColor?: string;
  durationMs?: number;
  size?: number;
  disabled?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /**
   * Called when the press animation reaches the complete frame.
   * May return a Promise — when `resetAfterComplete` is true, the button
   * stays on the complete frame (and busy) until that Promise settles
   * (success or failure), then resets. Used by share / external ops.
   */
  onAnimationComplete?: () => void | Promise<void>;
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
  label,
  labelColor,
  durationMs = PRESS_ANIMATION_MS,
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

  const releaseBusyAndMaybeReset = useCallback(() => {
    busyRef.current = false;
    if (resetAfterComplete) {
      progress.value = withTiming(active ? 1 : 0, { duration: reducedMotion ? 0 : 100 });
    }
  }, [active, progress, reducedMotion, resetAfterComplete]);

  const finish = useCallback(() => {
    // Keep busy until external Promise settles so double-tap cannot re-open.
    let result: void | Promise<void>;
    try {
      result = onAnimationComplete?.();
    } catch {
      releaseBusyAndMaybeReset();
      return;
    }
    if (result != null && typeof (result as Promise<void>).then === 'function') {
      Promise.resolve(result).then(
        () => releaseBusyAndMaybeReset(),
        () => releaseBusyAndMaybeReset(),
      );
      return;
    }
    releaseBusyAndMaybeReset();
  }, [onAnimationComplete, releaseBusyAndMaybeReset]);

  useEffect(() => {
    if (busyRef.current) return;
    progress.value = withTiming(active ? 1 : 0, { duration: reducedMotion ? 0 : 100 });
  }, [active, progress, reducedMotion]);

  const handlePress = useCallback(() => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    onPress?.();
    if (reducedMotion) {
      // Same sequencing as animated path (complete → external settle → reset),
      // with zero animation duration.
      finish();
      return;
    }
    const target = (activeOnPress ?? true) ? 1 : 0;
    progress.value = withTiming(target, { duration: durationMs }, (finished) => {
      if (finished) runOnJS(finish)();
      else runOnJS(releaseBusyAndMaybeReset)();
    });
  }, [activeOnPress, disabled, durationMs, finish, onPress, progress, reducedMotion, releaseBusyAndMaybeReset]);

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
      style={[
        styles.pressable,
        label ? styles.labeledPressable : { width: size, height: size },
        style,
      ]}
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
      {label ? (
        <Text style={[styles.label, { color: labelColor ?? color }]} numberOfLines={2}>
          {label}
        </Text>
      ) : null}
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
  labeledPressable: {
    minWidth: 44,
    minHeight: 44,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
    flexGrow: 1,
    minWidth: 0,
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
