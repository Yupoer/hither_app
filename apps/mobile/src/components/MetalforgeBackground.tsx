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

/** Calibrated from the supplied Metalforge umbrellas reference. */
export const METALFORGE_COLORS = [
  '#9A502B', '#83809B', '#002142',
  '#3A3F5E', '#04172E', '#BE5704',
  '#04172E', '#AD4F03', '#9B7683',
] as const;

export const METALFORGE_PARAMETERS = {
  speed: 1.05,
  flow: 2.2,
  grain: 10.5,
  brightness: 0.72,
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
  const isActive = active && appActive && !reducedMotion;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const values = [first, second, third];
    values.forEach((value, index) => {
      if (!isActive) {
        cancelAnimation(value);
        return;
      }
      value.value = withRepeat(
        withTiming(1, { duration: Math.round((8600 + index * 1200) / METALFORGE_PARAMETERS.speed) }),
        -1,
        true,
      );
    });
    return () => values.forEach((value) => cancelAnimation(value));
  }, [first, isActive, second, third]);

  const firstStyle = useAnimatedStyle(() => ({
    opacity: 0.78 + first.value * 0.12,
    transform: [{ translateX: (first.value - 0.5) * 18 }, { translateY: (first.value - 0.5) * 12 }],
  }));
  const secondStyle = useAnimatedStyle(() => ({
    opacity: 0.64 + second.value * 0.16,
    transform: [{ translateX: (0.5 - second.value) * 22 }, { translateY: (second.value - 0.5) * 16 }],
  }));
  const thirdStyle = useAnimatedStyle(() => ({
    opacity: 0.58 + third.value * 0.18,
    transform: [{ translateX: (third.value - 0.5) * 26 }, { translateY: (0.5 - third.value) * 18 }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden>
      <Animated.View style={[StyleSheet.absoluteFill, firstStyle]}>
        <LinearGradient colors={layerColors[0]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, secondStyle]}>
        <LinearGradient colors={layerColors[1]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, thirdStyle]}>
        <LinearGradient colors={layerColors[2]} start={{ x: 0.1, y: 1 }} end={{ x: 0.9, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Image
        source={require('../../assets/metalforge-grain.png')}
        resizeMode="repeat"
        style={styles.grain}
      />
      <View style={styles.scrim} />
    </View>
  );
}

const styles = StyleSheet.create({
  grain: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: METALFORGE_PARAMETERS.grain / 100 },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: `rgba(0,0,0,${1 - METALFORGE_PARAMETERS.brightness})` },
});
