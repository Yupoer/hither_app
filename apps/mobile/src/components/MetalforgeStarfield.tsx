import React, { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { createStarfieldParticles, STARFIELD_BASELINE } from '../utils/starfieldParticles';

export const METALFORGE_STARFIELD_RUNTIME_FACTORS = {
  speed: 0.5, twinkleFrequency: 1 / 9, density: 0.5, radius: 4.5, maxFps: 20, lowPowerFps: 10,
} as const;
export interface StarfieldAnimationPolicyInput {
  active: boolean; appActive: boolean; reducedMotion: boolean; lowPowerMode?: boolean | null; thermalState?: string | null;
}
export function getMetalforgeStarfieldAnimationPolicy(input: StarfieldAnimationPolicyInput) {
  const heat = input.thermalState?.toLowerCase();
  return {
    shouldAnimate: input.active && input.appActive && !input.reducedMotion && heat !== 'serious' && heat !== 'critical',
    fps: input.lowPowerMode || heat === 'fair' ? 10 : 20,
  };
}
export type MetalforgeStarfieldProps = {
  active?: boolean; collapsed?: boolean; lowPowerMode?: boolean | null; thermalState?: string | null; style?: StyleProp<ViewStyle>;
};
export default function MetalforgeStarfield({ active = true, collapsed = false, lowPowerMode, thermalState, style }: MetalforgeStarfieldProps) {
  const reducedMotion = useReducedMotion();
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const elapsed = useSharedValue(0);
  const lastFrameAt = useSharedValue(-1);
  const accumulated = useSharedValue(0);
  const policy = getMetalforgeStarfieldAnimationPolicy({ active, appActive, reducedMotion, lowPowerMode, thermalState });
  const particles = useMemo(() => createStarfieldParticles(width, height, collapsed), [width, height, collapsed]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  const frame = useFrameCallback(({ timestamp, timeSincePreviousFrame }) => {
    if (!policy.shouldAnimate) return;
    const delta = lastFrameAt.value < 0 ? 0 : Math.min(timestamp - lastFrameAt.value, 100);
    lastFrameAt.value = timestamp;
    accumulated.value += delta || Math.min(timeSincePreviousFrame ?? 0, 100);
    if (accumulated.value < 1000 / policy.fps) return;
    elapsed.value += accumulated.value / 1000;
    accumulated.value = 0;
  }, false);
  useEffect(() => {
    lastFrameAt.value = -1;
    accumulated.value = 0;
    frame.setActive(policy.shouldAnimate);
    return () => frame.setActive(false);
  }, [policy.shouldAnimate, frame, lastFrameAt, accumulated]);
  const paths = useDerivedValue(() => {
    const core = Skia.Path.Make();
    const halo = Skia.Path.Make();
    for (const star of particles) {
      const margin = star.radius * 3;
      const x = ((star.x + elapsed.value * star.velocity + margin) % (width + margin * 2)) - margin;
      const twinkle = 1 + Math.sin(elapsed.value * STARFIELD_BASELINE.twinkleFrequency + star.phase) * 0.15;
      core.addCircle(x, star.y, star.radius * twinkle);
      halo.addCircle(x, star.y, star.radius * twinkle * 2);
    }
    return { core, halo };
  }, [particles, width]);
  const corePath = useDerivedValue(() => paths.value.core);
  const haloPath = useDerivedValue(() => paths.value.halo);
  return <View onLayout={({ nativeEvent }) => setSize(current => current.width === nativeEvent.layout.width && current.height === nativeEvent.layout.height ? current : nativeEvent.layout)}
    pointerEvents="none" accessibilityElementsHidden style={[StyleSheet.absoluteFill, styles.container, style]}>
    <Canvas style={StyleSheet.absoluteFill}>
      <Path path={haloPath} color="rgba(255,255,255,0.10)" />
      <Path path={corePath} color="rgba(255,255,255,0.80)" />
    </Canvas>
  </View>;
}
const styles = StyleSheet.create({ container: { overflow: 'hidden', zIndex: 0 } });
