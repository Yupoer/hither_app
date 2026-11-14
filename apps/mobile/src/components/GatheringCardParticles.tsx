import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import Animated, { type DerivedValue, useAnimatedStyle, useDerivedValue, useFrameCallback, useReducedMotion,
  useSharedValue, withTiming } from 'react-native-reanimated';
import { useMountEffect } from '../hooks/useMountEffect';
import { useForegroundUi } from '../state/foregroundUi';
import { energyObservability } from '../state/energyObservability';
import {
  GATHERING_PARTICLE_MAX_FPS, GATHERING_PARTICLE_RISE_MS, GATHERING_PARTICLE_SETTLE_MS,
  GATHERING_PARTICLE_SHADES, gatheringParticlesAt,
} from '../utils/gatheringCardParticles';

function GatheringCardParticles({
  running, visible = true, lowPowerMode, thermalState,
}: {
  running: boolean;
  visible?: boolean;
  lowPowerMode?: boolean | null;
  thermalState?: string | null;
}) {
  const foreground = useForegroundUi();
  const reducedMotion = useReducedMotion();
  const allowsMotion = visible && foreground && !reducedMotion
    && lowPowerMode !== true && (thermalState == null || thermalState === 'nominal');
  const [settled, setSettled] = useState(true);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const moving = allowsMotion && running;
  const drawing = allowsMotion && (moving || !settled);
  const blend = useSharedValue(0);
  const clock = useSharedValue(0);
  const frameElapsed = useSharedValue(0);
  const frame = useFrameCallback(({ timeSincePreviousFrame }) => {
    if (timeSincePreviousFrame == null) {
      frameElapsed.value = 0;
      return;
    }
    frameElapsed.value += timeSincePreviousFrame;
    if (frameElapsed.value + 0.5 < 1000 / GATHERING_PARTICLE_MAX_FPS) return;
    clock.value += Math.min(64, frameElapsed.value);
    frameElapsed.value = 0;
  }, false);
  const flightStyle = useAnimatedStyle(() => ({ opacity: blend.value }));
  return (
    <View testID="gathering-card-particles" pointerEvents="none" accessibilityElementsHidden
      style={styles.fill} onLayout={({ nativeEvent: { layout: { width, height } } }) =>
        setSize(current => current.width === width && current.height === height ? current : { width, height })}>
      <ParticleMotion key={moving ? 'move' : allowsMotion ? 'settle' : 'idle'}
        moving={moving} allowsMotion={allowsMotion} blend={blend} settle={setSettled} />
      {drawing && size.width > 0 && size.height > 0 ? (
        <Animated.View style={[styles.fill, flightStyle]}>
          <ParticleCanvas {...size} frame={frame} time={clock} />
        </Animated.View>
      ) : null}
    </View>
  );
}

function ParticleMotion({ moving, allowsMotion, blend, settle }: {
  moving: boolean;
  allowsMotion: boolean;
  blend: ReturnType<typeof useSharedValue<number>>;
  settle: (value: boolean) => void;
}) {
  useMountEffect(() => {
    if (!allowsMotion) {
      blend.set(0);
      settle(true);
    } else if (moving) {
      settle(false);
      blend.set(withTiming(1, { duration: GATHERING_PARTICLE_RISE_MS }));
    } else {
      blend.set(withTiming(0, { duration: GATHERING_PARTICLE_SETTLE_MS }));
      const timer = setTimeout(() => settle(true), GATHERING_PARTICLE_SETTLE_MS);
      return () => clearTimeout(timer);
    }
  });
  return null;
}

function ParticleCanvas({ width, height, frame, time }: {
  width: number;
  height: number;
  frame: ReturnType<typeof useFrameCallback>;
  time: ReturnType<typeof useSharedValue<number>>;
}) {
  useMountEffect(() => {
    time.set(0);
    frame.setActive(true);
    const unmountWorkload = energyObservability.mountWorkload({ starfieldCanvasCount: 1, animatedCanvasCount: 1 });
    return () => { frame.setActive(false); unmountWorkload(); };
  });
  const buffers = useMemo(() => Array.from({ length: GATHERING_PARTICLE_SHADES.length * 2 }, () => Skia.Path.Make()), []);
  const paths = useDerivedValue(() => {
    const count = GATHERING_PARTICLE_SHADES.length;
    for (const path of buffers) path.rewind();
    for (const particle of gatheringParticlesAt(time.value, width, height)) {
      const { x, y, radius, shade } = particle;
      buffers[shade].addCircle(x, y, radius * 1.65);
      buffers[shade + count].addCircle(x, y, radius);
    }
    return buffers.slice();
  });
  return (
    <Canvas style={StyleSheet.absoluteFill}>
      {GATHERING_PARTICLE_SHADES.map((opacity, index) => <ParticleLayer key={index}
        index={index} opacity={opacity * 0.16} paths={paths} />)}
      {GATHERING_PARTICLE_SHADES.map((opacity, index) => <ParticleLayer key={index + GATHERING_PARTICLE_SHADES.length}
        index={index + GATHERING_PARTICLE_SHADES.length} opacity={opacity} paths={paths} />)}
    </Canvas>
  );
}

function ParticleLayer({ paths, index, opacity }: { paths: DerivedValue<SkPath[]>; index: number; opacity: number }) {
  const path = useDerivedValue(() => paths.value[index]);
  return <Path path={path} color="#fff" opacity={opacity} />;
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
});

export default React.memo(GatheringCardParticles);
