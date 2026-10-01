import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { optionalVisualsAllowed } from '../state/runtimePowerState';
import { useForegroundUi } from '../state/foregroundUi';
import { energyObservability } from '../state/energyObservability';
import { createStarfieldParticles, STARFIELD_BASELINE } from '../utils/starfieldParticles';
import { advanceStarfieldPhase, advanceStarfieldPosition, STARFIELD_PERIOD_SECONDS } from '../utils/starfieldPhase';

export const METALFORGE_STARFIELD_RUNTIME_FACTORS = {
  speed: 0.5, twinkleFrequency: 1 / 9, density: 0.5, radius: 4.5, maxFps: 20, lowPowerFps: 10,
} as const;
export interface StarfieldAnimationPolicyInput {
  active: boolean; appActive: boolean; reducedMotion: boolean; lowPowerMode?: boolean | null; thermalState?: string | null;
}
export function getMetalforgeStarfieldAnimationPolicy(input: StarfieldAnimationPolicyInput) {
  return {
    shouldAnimate: input.active && input.appActive && !input.reducedMotion && optionalVisualsAllowed({
      thermalState: input.thermalState ?? null, lowPowerMode: input.lowPowerMode ?? null,
    }),
    fps: 20,
  };
}
export type MetalforgeStarfieldProps = {
  active?: boolean; collapsed?: boolean; lowPowerMode?: boolean | null; thermalState?: string | null; style?: StyleProp<ViewStyle>;
};
export default function MetalforgeStarfield({ active = true, collapsed = false, lowPowerMode, thermalState, style }: MetalforgeStarfieldProps) {
  const reducedMotion = useReducedMotion();
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const appActive = useForegroundUi();
  const phase = useSharedValue(0);
  const positions = useSharedValue<number[]>([]);
  const lastFrameAt = useSharedValue(-1);
  const accumulated = useSharedValue(0);
  const policy = getMetalforgeStarfieldAnimationPolicy({ active, appActive, reducedMotion, lowPowerMode, thermalState });
  const visible = active && appActive;
  useEffect(() => energyObservability.mountWorkload({ starfieldCanvasCount: visible ? 1 : 0, animatedCanvasCount: policy.shouldAnimate ? 1 : 0 }), [visible, policy.shouldAnimate]);
  const particles = useMemo(() => createStarfieldParticles(width, height, collapsed), [width, height, collapsed]);
  useEffect(() => { positions.value = particles.map(star => star.x + star.radius * 3); }, [particles, positions]);
  const frame = useFrameCallback(({ timestamp, timeSincePreviousFrame }) => {
    if (!policy.shouldAnimate) return;
    const delta = lastFrameAt.value < 0 ? 0 : Math.min(timestamp - lastFrameAt.value, 100);
    lastFrameAt.value = timestamp;
    accumulated.value += delta || Math.min(timeSincePreviousFrame ?? 0, 100);
    if (accumulated.value < 1000 / policy.fps) return;
    phase.value = advanceStarfieldPhase(phase.value, accumulated.value,
      STARFIELD_PERIOD_SECONDS * STARFIELD_BASELINE.twinkleFrequency / (Math.PI * 2));
    positions.value = particles.map((star, index) => advanceStarfieldPosition(
      positions.value[index] ?? star.x + star.radius * 3, accumulated.value, star.velocity, width + star.radius * 6));
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
    for (const [index, star] of particles.entries()) {
      const margin = star.radius * 3;
      const x = (positions.value[index] ?? star.x + margin) - margin;
      const twinkle = 1 + Math.sin(phase.value * Math.PI * 2 + star.phase) * 0.15;
      core.addCircle(x, star.y, star.radius * twinkle);
      halo.addCircle(x, star.y, star.radius * twinkle * 2);
    }
    return { core, halo };
  }, [particles, width]);
  const corePath = useDerivedValue(() => paths.value.core);
  const haloPath = useDerivedValue(() => paths.value.halo);
  if (!visible) return null;
  return <View onLayout={({ nativeEvent }) => setSize(current => current.width === nativeEvent.layout.width && current.height === nativeEvent.layout.height ? current : nativeEvent.layout)}
    pointerEvents="none" accessibilityElementsHidden style={[StyleSheet.absoluteFill, styles.container, style]}>
    <Canvas style={StyleSheet.absoluteFill}>
      <Path path={haloPath} color="rgba(255,255,255,0.10)" />
      <Path path={corePath} color="rgba(255,255,255,0.80)" />
    </Canvas>
  </View>;
}
const styles = StyleSheet.create({ container: { overflow: 'hidden', zIndex: 0 } });
