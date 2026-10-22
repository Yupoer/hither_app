import { useMountEffect } from '../hooks/useMountEffect';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { type DerivedValue, useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { optionalVisualsAllowed } from '../state/runtimePowerState';
import { useForegroundUi } from '../state/foregroundUi';
import { energyObservability } from '../state/energyObservability';
import { chargeBallsAt, changeChargeEmission, CHARGE_BALL_MAX_TRAVEL_MS, CHARGE_BALL_OPACITY_LEVELS, CHARGE_BALL_MIN_OPACITY, CHARGE_BALL_MAX_OPACITY, type ChargeEmission } from '../utils/starfieldParticles';

export const METALFORGE_STARFIELD_RUNTIME_FACTORS = { maxFps: 60 } as const;
export interface StarfieldAnimationPolicyInput {
  active: boolean; appActive: boolean; reducedMotion: boolean; lowPowerMode?: boolean | null; thermalState?: string | null;
}
export function getMetalforgeStarfieldAnimationPolicy(input: StarfieldAnimationPolicyInput) {
  return {
    shouldAnimate: input.active && input.appActive && !input.reducedMotion && optionalVisualsAllowed({
      thermalState: input.thermalState ?? null, lowPowerMode: input.lowPowerMode ?? null,
    }),
    fps: METALFORGE_STARFIELD_RUNTIME_FACTORS.maxFps,
  };
}
export type MetalforgeStarfieldProps = {
  emitting?: boolean; active?: boolean; lowPowerMode?: boolean | null; thermalState?: string | null; color?: string; style?: StyleProp<ViewStyle>;
};
/** Solid circles enter from the left. The same field lives through expansion and exit. */
export default function MetalforgeStarfield({ emitting = false, active = true, lowPowerMode, thermalState, color = '#FFFFFF', style }: MetalforgeStarfieldProps) {
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [windows, setWindows] = useState<ChargeEmission[]>([]);
  const emissions = useSharedValue<ChargeEmission[]>([]);
  // Particle births, motion and drain deadlines share an active-only clock.
  const now = useSharedValue(0);
  const lastFrameAt = useSharedValue(-1);
  const appActive = useForegroundUi();
  const visible = active && appActive && windows.length > 0;
  const policy = getMetalforgeStarfieldAnimationPolicy({ active: active && windows.length > 0, appActive, reducedMotion, lowPowerMode, thermalState });

  const frame = useFrameCallback(({ timestamp }) => {
    if (!policy.shouldAnimate) return;
    if (lastFrameAt.value < 0) { lastFrameAt.value = timestamp; return; }
    const delta = Math.max(0, timestamp - lastFrameAt.value);
    // Allow timestamp rounding at 60Hz without accidentally dropping to 30Hz.
    if (delta + 0.5 < 1000 / policy.fps) return;
    lastFrameAt.value = timestamp;
    now.value += Math.min(delta, 100);
  }, false);

  const paths = useDerivedValue(() => {
    const layers = Array.from({ length: CHARGE_BALL_OPACITY_LEVELS }, () => Skia.Path.Make());
    for (const ball of chargeBallsAt(now.value, width, emissions.value)) {
      layers[ball.shade].addCircle(ball.x, ball.y, ball.radius);
    }
    return layers;
  }, [width]);
  const shades = useMemo(() => Array.from({ length: CHARGE_BALL_OPACITY_LEVELS }, (_, index) =>
    CHARGE_BALL_MIN_OPACITY + (CHARGE_BALL_MAX_OPACITY - CHARGE_BALL_MIN_OPACITY) * index / (CHARGE_BALL_OPACITY_LEVELS - 1)), []);
  return <View onLayout={({ nativeEvent }) => setWidth(current => current === nativeEvent.layout.width ? current : nativeEvent.layout.width)}
    pointerEvents="none" accessibilityElementsHidden style={[StyleSheet.absoluteFill, styles.container, style]}>
    <ChargeEmissionIntent key={String(emitting)} emitting={emitting} now={now} setWindows={setWindows} />
    <ChargeWindowResources emissions={emissions} windows={windows} shouldAnimate={policy.shouldAnimate} now={now} setWindows={setWindows} />
    <ChargeFrameMotion shouldAnimate={policy.shouldAnimate} frame={frame} lastFrameAt={lastFrameAt} />
    <StarfieldWorkload key={`${visible}:${policy.shouldAnimate}`} visible={visible} shouldAnimate={policy.shouldAnimate} />
    {visible && <Canvas style={StyleSheet.absoluteFill}>
      {shades.map((opacity, index) => <ChargeBallLayer key={index} paths={paths} index={index} opacity={opacity} color={color} />)}
    </Canvas>}
  </View>;
}
const styles = StyleSheet.create({ container: { overflow: 'hidden', zIndex: 0 } });
function ChargeBallLayer({ paths, index, opacity, color }: {
  paths: DerivedValue<SkPath[]>; index: number; opacity: number; color: string;
}) {
  const path = useDerivedValue(() => paths.value[index]);
  return <Path path={path} color={color} opacity={opacity} />;
}

function ChargeEmissionIntent({ emitting, now, setWindows }: { emitting: boolean; now: ReturnType<typeof useSharedValue<number>>; setWindows: React.Dispatch<React.SetStateAction<ChargeEmission[]>> }) {
  useMountEffect(() => {
    const at = now.value;
    setWindows(current => changeChargeEmission(current, emitting, at));
  });
  return null;
}

function ChargeEmissionPublication({ emissions, windows }: { emissions: ReturnType<typeof useSharedValue<ChargeEmission[]>>; windows: ChargeEmission[] }) {
  useMountEffect(() => { emissions.value = windows; });
  return null;
}

function ChargeDrainDeadline({ windows, shouldAnimate, now, setWindows }: { windows: ChargeEmission[]; shouldAnimate: boolean; now: ReturnType<typeof useSharedValue<number>>; setWindows: React.Dispatch<React.SetStateAction<ChargeEmission[]>> }) {
  useMountEffect(() => {
    if (!shouldAnimate) return;
    const stopped = windows.filter(window => window.stoppedAt != null);
    if (!stopped.length) return;
    const deadline = Math.min(...stopped.map(window => window.stoppedAt! + CHARGE_BALL_MAX_TRAVEL_MS));
    const timer = setTimeout(() => {
      setWindows(current => current.filter(window => window.stoppedAt == null || now.value < window.stoppedAt + CHARGE_BALL_MAX_TRAVEL_MS));
    }, Math.max(1, deadline - now.value));
    return () => clearTimeout(timer);
  });
  return null;
}

function ChargeFrameActivation({ shouldAnimate, frame, lastFrameAt }: { shouldAnimate: boolean; frame: ReturnType<typeof useFrameCallback>; lastFrameAt: ReturnType<typeof useSharedValue<number>> }) {
  useMountEffect(() => {
    lastFrameAt.value = -1;
    frame.setActive(shouldAnimate);
    return () => frame.setActive(false);
  });
  return null;
}

function StarfieldWorkload({ visible, shouldAnimate }: { visible: boolean; shouldAnimate: boolean }) {
  useMountEffect(() => energyObservability.mountWorkload({ starfieldCanvasCount: visible ? 1 : 0, animatedCanvasCount: shouldAnimate ? 1 : 0 }));
  return null;
}

function ChargeWindowResources({ emissions, windows, shouldAnimate, now, setWindows }: React.ComponentProps<typeof ChargeDrainDeadline> & Pick<React.ComponentProps<typeof ChargeEmissionPublication>, 'emissions'>) {
  const [emissionInput, setEmissionInput] = useState({ windows, generation: 0 });
  if (!Object.is(emissionInput.windows, windows)) {
    setEmissionInput({ windows, generation: emissionInput.generation + 1 });
  }
  return <>
    <ChargeEmissionPublication key={`emissions-${emissionInput.generation}`} emissions={emissions} windows={windows} />
    <ChargeDrainDeadline key={`drain-${emissionInput.generation}:${shouldAnimate}`} windows={windows} shouldAnimate={shouldAnimate} now={now} setWindows={setWindows} />
  </>;
}
function ChargeFrameMotion(props: React.ComponentProps<typeof ChargeFrameActivation>) {
  const { frame, shouldAnimate } = props;
  const [frameInput, setFrameInput] = useState({ frame, shouldAnimate, generation: 0 });
  if (!Object.is(frameInput.frame, frame) || !Object.is(frameInput.shouldAnimate, shouldAnimate)) {
    setFrameInput({ frame, shouldAnimate, generation: frameInput.generation + 1 });
  }
  return <ChargeFrameActivation key={frameInput.generation} {...props} />;
}
