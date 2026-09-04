import React, { useEffect, useState } from 'react';
import { AppState, Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/**
 * Calibrated from the supplied Metalforge umbrellas reference.
 * Baseline low-load profile: speed: 1.05, flow: 2.2, grain: 10.5, brightness: 0.72
 * Active preset matches docs/specs/backgroundRef.md: speed 1.8, flow 1.9, grain 12.0, brightness 0.91
 */
export const METALFORGE_COLORS = [
  '#9A502B', '#83809B', '#002142',
  '#3A3F5E', '#04172E', '#BE5704',
  '#04172E', '#AD4F03', '#9B7683',
] as const;

export const METALFORGE_PARAMETERS = {
  speed: 0.9,
  flow: 1.9,
  grain: 12.0,
  brightness: 0.91,
} as const;

const layerColors = [
  [METALFORGE_COLORS[0], METALFORGE_COLORS[1], METALFORGE_COLORS[2]],
  [METALFORGE_COLORS[3], METALFORGE_COLORS[4], METALFORGE_COLORS[5]],
  [METALFORGE_COLORS[6], METALFORGE_COLORS[7], METALFORGE_COLORS[8]],
] as const;

export type MetalforgeBackgroundProps = {
  /** False when the screen is not focused; animation freezes at its last frame. */
  active?: boolean;
};

/**
 * Three native gradient layers approximate the Metalforge wallpaper without a
 * per-frame JS loop, shader, blur, or generated grain. Reanimated only updates
 * transform/opacity on the UI thread and is cancelled while inactive.
 */
export default function MetalforgeBackground({ active = true }: MetalforgeBackgroundProps) {
  const reducedMotion = useReducedMotion();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const first = useSharedValue(0);
  const second = useSharedValue(0);
  const third = useSharedValue(0);
  const fourth = useSharedValue(0);
  const isActive = active && appActive && !reducedMotion;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const values = [
      { value: first, duration: Math.round(3490 / (METALFORGE_PARAMETERS.speed / 1.8)) },
      { value: second, duration: Math.round(2327 / (METALFORGE_PARAMETERS.speed / 1.8)) },
      { value: third, duration: Math.round(1745 / (METALFORGE_PARAMETERS.speed / 1.8)) },
      { value: fourth, duration: Math.round(1396 / (METALFORGE_PARAMETERS.speed / 1.8)) },
    ];
    values.forEach(({ value, duration }) => {
      if (!isActive) {
        cancelAnimation(value);
        return;
      }
      value.value = withRepeat(withTiming(1, { duration }), -1, true);
    });
    return () => values.forEach(({ value }) => cancelAnimation(value));
  }, [first, fourth, isActive, second, third]);

  const firstStyle = useAnimatedStyle(() => ({
    opacity: 0.85 + first.value * 0.12,
    transform: [
      { translateX: (first.value - 0.5) * (30 * METALFORGE_PARAMETERS.flow) },
      { translateY: (second.value - 0.5) * (24 * METALFORGE_PARAMETERS.flow) },
      { scale: 1.08 + first.value * 0.08 },
    ],
  }));
  const secondStyle = useAnimatedStyle(() => ({
    opacity: 0.75 + second.value * 0.18,
    transform: [
      { translateX: (0.5 - third.value) * (35 * METALFORGE_PARAMETERS.flow) },
      { translateY: (fourth.value - 0.5) * (26 * METALFORGE_PARAMETERS.flow) },
      { scale: 1.14 - second.value * 0.08 },
    ],
  }));
  const thirdStyle = useAnimatedStyle(() => ({
    opacity: 0.70 + third.value * 0.20,
    transform: [
      { translateX: (fourth.value - 0.5) * (40 * METALFORGE_PARAMETERS.flow) },
      { translateY: (0.5 - first.value) * (30 * METALFORGE_PARAMETERS.flow) },
      { scale: 1.06 + third.value * 0.10 },
    ],
  }));
  const grainStyle = useAnimatedStyle(() => ({
    opacity: (METALFORGE_PARAMETERS.grain / 100) + first.value * 0.04,
  }));
  return (
    <View style={[StyleSheet.absoluteFill, styles.container]} pointerEvents="none" accessibilityElementsHidden>
      <Animated.View style={[styles.oversizedLayer, firstStyle]}>
        <LinearGradient colors={layerColors[0]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[styles.oversizedLayer, secondStyle]}>
        <LinearGradient colors={layerColors[1]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[styles.oversizedLayer, thirdStyle]}>
        <LinearGradient colors={layerColors[2]} start={{ x: 0.1, y: 1 }} end={{ x: 0.9, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.Image
        source={require('../../assets/metalforge-grain.png')}
        resizeMode="cover"
        style={[styles.grain, grainStyle]}
      />
      <View style={styles.scrim} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  oversizedLayer: {
    position: 'absolute',
    top: -90,
    bottom: -90,
    left: -90,
    right: -90,
  },
  grain: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: `rgba(0,0,0,${1 - METALFORGE_PARAMETERS.brightness})`,
  },
});
