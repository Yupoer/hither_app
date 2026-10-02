import React, { useCallback, useEffect, useRef, useSyncExternalStore, type ComponentProps } from 'react';
import {
  Pressable,
  AppState,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useOptionalVisuals, isForegroundUi } from '../state/foregroundUi';
import { loadingDotOffset, authLoadingMotionAllowed } from '../utils/loadingDots';
import { getRuntimePowerState, subscribeRuntimePowerState } from '../state/runtimePowerState';

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
  /** Keep the label centered in the full button bounds with a fixed left icon. */
  centeredLabel?: boolean;
  durationMs?: number;
  size?: number;
  disabled?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * Bump to force progress back to `active` after a cancelled morph
   * (`resetAfterComplete={false}` otherwise leaves the complete frame).
   */
  revertEpoch?: number;
  onPress?: () => void;
  /**
   * Called once after an accepted press reaches the complete frame, or when
   * optional motion is cancelled. Visual suspension never discards the action.
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
  centeredLabel = false,
  durationMs = PRESS_ANIMATION_MS,
  size = 44,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
  revertEpoch = 0,
  onPress,
  onAnimationComplete,
}: AmicroButtonProps) {
  const visuals = useOptionalVisuals();
  const reducedMotion = useReducedMotion() || !visuals;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const progress = useSharedValue(active ? 1 : 0);
  const busyRef = useRef(false);
  const pendingCompletionRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const releaseBusyAndMaybeReset = useCallback(() => {
    busyRef.current = false;
    if (resetAfterComplete) {
      progress.value = isForegroundUi() && !reducedMotionRef.current
        ? withTiming(activeRef.current ? 1 : 0, { duration: 100 })
        : (activeRef.current ? 1 : 0);
    }
  }, [progress, resetAfterComplete]);

  const finish = useCallback(() => {
    // An accepted press is semantic work; cancelling its decoration must not lose it.
    if (!pendingCompletionRef.current) return;
    pendingCompletionRef.current = false;
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
    if (!visuals) { cancelAnimation(progress); progress.value = active ? 1 : 0; return; }
    if (busyRef.current) return;
    progress.value = withTiming(active ? 1 : 0, { duration: reducedMotion ? 0 : 100 });
  }, [active, revertEpoch, progress, reducedMotion, visuals]);

  const handlePress = useCallback(() => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    pendingCompletionRef.current = true;
    onPress?.();
    if (reducedMotion) {
      // Same sequencing as animated path (complete → external settle → reset),
      // with zero animation duration.
      finish();
      return;
    }
    const target = (activeOnPress ?? true) ? 1 : 0;
    progress.value = withTiming(target, { duration: durationMs }, () => {
      runOnJS(finish)();
    });
  }, [activeOnPress, disabled, durationMs, finish, onPress, progress, reducedMotion]);

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
        label
          ? centeredLabel
            ? styles.centeredLabeledPressable
            : styles.labeledPressable
          : { width: size, height: size },
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
      <View style={[styles.iconSlot, centeredLabel && styles.centeredIconSlot]}>
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
        <Text
          style={[
            styles.label,
            centeredLabel && styles.centeredLabel,
            { color: labelColor ?? color },
          ]}
          numberOfLines={2}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const subscribeAppState = (listener: () => void) => {
  const subscription = AppState.addEventListener('change', listener);
  return () => subscription.remove();
};
const getAppState = () => AppState.currentState;

export function BouncingDots({ color, allowInactive = false }: { color: string; allowInactive?: boolean }) {
  const visuals = useOptionalVisuals();
  const appState = useSyncExternalStore(subscribeAppState, getAppState, getAppState);
  const power = useSyncExternalStore(subscribeRuntimePowerState, getRuntimePowerState, getRuntimePowerState);
  const animate = allowInactive ? authLoadingMotionAllowed(appState, power.thermalState, power.lowPowerMode) : visuals;
  const reducedMotion = useReducedMotion() || !animate;
  const phase = useSharedValue(0);

  useEffect(() => {
    phase.value = reducedMotion ? 0 : withRepeat(withTiming(1, {
      duration: 800, easing: Easing.linear,
    }), -1, false);
    return () => cancelAnimation(phase);
  }, [phase, reducedMotion]);

  const firstStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reducedMotion ? 0 : loadingDotOffset(phase.value, 0) }, { scaleY: reducedMotion ? 1 : interpolate(loadingDotOffset(phase.value, 0), [-20, 0], [1.1, 0.8]) }],
  }));
  const secondStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reducedMotion ? 0 : loadingDotOffset(phase.value, 1) }, { scaleY: reducedMotion ? 1 : interpolate(loadingDotOffset(phase.value, 1), [-20, 0], [1.1, 0.8]) }],
  }));
  const thirdStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reducedMotion ? 0 : loadingDotOffset(phase.value, 2) }, { scaleY: reducedMotion ? 1 : interpolate(loadingDotOffset(phase.value, 2), [-20, 0], [1.1, 0.8]) }],
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
  centeredLabeledPressable: {
    minWidth: 44,
    minHeight: 44,
    position: 'relative',
    justifyContent: 'center',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
    flexGrow: 1,
    minWidth: 0,
  },
  centeredLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  iconSlot: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centeredIconSlot: {
    position: 'absolute',
    left: 16,
    top: 0,
    width: 24,
    height: '100%',
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
