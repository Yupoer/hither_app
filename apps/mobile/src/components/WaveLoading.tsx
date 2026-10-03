import React, { useEffect, useSyncExternalStore } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useAppState, useOptionalVisuals } from '../state/foregroundUi';
import { getRuntimePowerState, subscribeRuntimePowerState } from '../state/runtimePowerState';
import { authLoadingMotionAllowed, loadingDotOffset } from '../utils/loadingDots';

export interface WaveLoadingProps {
  color: string;
  size?: 'small' | 'large' | number;
  style?: StyleProp<ViewStyle>;
  allowInactive?: boolean;
}

/** One continuous clock drives the same wave in screens, buttons and auth. */
export default function WaveLoading({ color, size = 32, style, allowInactive = false }: WaveLoadingProps) {
  const visuals = useOptionalVisuals();
  const appState = useAppState();
  const power = useSyncExternalStore(subscribeRuntimePowerState, getRuntimePowerState, getRuntimePowerState);
  const animate = allowInactive ? authLoadingMotionAllowed(appState, power.thermalState, power.lowPowerMode) : visuals;
  const reducedMotion = useReducedMotion() || !animate;
  const phase = useSharedValue(0);
  const width = typeof size === 'number' ? size : size === 'large' ? 64 : 24;
  const scale = width / 64;
  useEffect(() => {
    phase.value = reducedMotion ? 0 : withRepeat(withTiming(1, { duration: 800, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(phase);
  }, [phase, reducedMotion]);
  const first = useAnimatedStyle(() => ({ transform: [
    { translateY: reducedMotion ? 0 : loadingDotOffset(phase.value, 0) * scale },
    { scaleY: reducedMotion ? 1 : interpolate(loadingDotOffset(phase.value, 0), [-20, 0], [1.1, 0.8]) },
  ] }));
  const second = useAnimatedStyle(() => ({ transform: [
    { translateY: reducedMotion ? 0 : loadingDotOffset(phase.value, 1) * scale },
    { scaleY: reducedMotion ? 1 : interpolate(loadingDotOffset(phase.value, 1), [-20, 0], [1.1, 0.8]) },
  ] }));
  const third = useAnimatedStyle(() => ({ transform: [
    { translateY: reducedMotion ? 0 : loadingDotOffset(phase.value, 2) * scale },
    { scaleY: reducedMotion ? 1 : interpolate(loadingDotOffset(phase.value, 2), [-20, 0], [1.1, 0.8]) },
  ] }));
  const dot = { width: 12 * scale, height: 12 * scale, borderRadius: 6 * scale, bottom: 8 * scale, backgroundColor: color };
  return <View style={[{ width, height: 48 * scale }, style]} accessibilityRole="progressbar" accessibilityLabel="Loading" pointerEvents="none">
    <Animated.View style={[styles.dot, dot, { left: 8 * scale }, first]} />
    <Animated.View style={[styles.dot, dot, { left: 26 * scale }, second]} />
    <Animated.View style={[styles.dot, dot, { left: 44 * scale }, third]} />
  </View>;
}
const styles = StyleSheet.create({ dot: { position: 'absolute' } });
