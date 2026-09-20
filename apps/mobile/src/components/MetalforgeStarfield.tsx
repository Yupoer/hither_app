/**
 * Black-box React Native / Expo approximation of MetalForge's public Starfield
 * preview.
 *
 * Source preview:
 * https://metalforge.xyz/editor#effect=starfield&speed=1.2&twinkleSpeed=2.6&twinkleAmount=0.3&layers=3&baseScale=50&scaleStep=80&density=0.11&starSize=0.13&starColor=%23FFFFFF&background=%23020208
 *
 * Public parameters reproduced here:
 * speed 1.2, twinkleSpeed 2.6, twinkleAmount 0.3, layers 3,
 * baseScale 50, scaleStep 80, density 0.11, starSize 0.13,
 * starColor #FFFFFF, background #020208.
 *
 * This is not MetalForge's Pro-only locked.metal or Expo project. It is an
 * independent GPU implementation based only on the public preview and URL
 * parameters. Requires @shopify/react-native-skia and react-native-reanimated.
 */

import React, { useEffect, useState } from 'react';
import {
  AppState,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';

const starfieldSkSL = Skia.RuntimeEffect.Make(`
uniform float2 size;
uniform float time;
uniform float speed;
uniform float twinkleSpeed;
uniform float twinkleAmount;
uniform float layers;
uniform float baseScale;
uniform float scaleStep;
uniform float density;
uniform float starSize;
uniform float radiusScale;
uniform half4 starColor;

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float2 hash22(float2 p) {
  return float2(hash21(p), hash21(p + float2(19.19, 73.73)));
}

half4 main(float2 fragCoord) {
  float2 safeSize = size;
  if (safeSize.x < 1.0) safeSize.x = 1.0;
  if (safeSize.y < 1.0) safeSize.y = 1.0;

  float2 uv = fragCoord / safeSize;
  float aspect = safeSize.x / safeSize.y;
  float2 point = float2((uv.x - 0.5) * aspect, uv.y - 0.5);
  // The starfield is composited over its existing SwiftUI glass parent. Keep
  // both RGB and alpha premultiplied so the shader never paints an opaque card
  // behind the particles.
  half3 result = half3(0.0);
  float resultAlpha = 0.0;
  float activeLayers = clamp(layers, 0.0, 5.0);
  float probability = clamp(density, 0.0, 1.0);

  // Five fixed iterations keep the shader compatible with SkSL; the uniform
  // controls how many of those layers contribute to the final image.
  for (int i = 0; i < 5; i++) {
    float layer = float(i);
    if (layer < activeLayers) {
      float scale = max(4.0, (baseScale + layer * scaleStep) * 0.20);
      float2 layerPoint = point * scale;
      // Stable row/slot identities allow independent velocities. Evaluating
      // neighbouring rows preserves halos; wrapping outside the card avoids pops.
      float period = aspect * scale + 2.0;
      float slots = clamp(ceil(period * probability), 1.0, 16.0);
      float slotPresence = min(1.0, period * probability / slots);
      for (int rowOffset = -1; rowOffset <= 1; rowOffset++) {
        float row = floor(layerPoint.y) + float(rowOffset);
        for (int slot = 0; slot < 16; slot++) {
          if (float(slot) < slots) {
            float2 seed = float2(float(slot), row) + float2(layer * 17.0, layer * 31.0);
            float present = step(1.0 - slotPresence, hash21(seed));
            float2 jitter = hash22(seed + float2(13.0, 29.0));
            float velocity = speed * (0.18 + layer * 0.08)
              * mix(5.0, 10.0, hash21(seed + float2(41.0, 83.0)));
            float x = fract(jitter.x + time * velocity / period) * period - period * 0.5;
            float y = row + 0.5 + (jitter.y - 0.5) * 0.70;
            float2 delta = layerPoint - float2(x, y);

            float radius = mix(0.004, 0.028, hash21(seed + float2(7.0, 19.0)));
            radius *= (0.70 + starSize * 3.0) * radiusScale;
            float distanceToStar = length(delta);
            float core = 1.0 - smoothstep(radius * 0.25, radius, distanceToStar);
            float halo = 1.0 - smoothstep(radius, radius * 3.0, distanceToStar);
            float phase = hash21(seed + float2(23.0, 47.0)) * 6.2831853;
            float twinkle = 1.0 + sin(time * twinkleSpeed * (0.65 + layer * 0.18) + phase) * twinkleAmount;
            float intensity = clamp(present * (core + halo * 0.12) * max(0.0, twinkle), 0.0, 1.0);
            float layerAlpha = (1.0 - resultAlpha) * intensity * starColor.a;
            result += starColor.rgb * half(layerAlpha);
            resultAlpha += layerAlpha;
          }
        }
      }
    }
  }

  return half4(clamp(result, half3(0.0), half3(1.0)), half(clamp(resultAlpha, 0.0, 1.0)));
}
`)!;

export const METALFORGE_STARFIELD_PARAMETERS = {
  speed: 1.2,
  twinkleSpeed: 2.6,
  twinkleAmount: 0.3,
  layers: 3,
  baseScale: 50,
  scaleStep: 80,
  density: 0.11,
  starSize: 0.13,
  starColor: '#FFFFFF',
  background: '#020208',
} as const;

/** Runtime tuning required by the approved performance pass. */
export const METALFORGE_STARFIELD_RUNTIME_FACTORS = {
  speed: 0.5,
  twinkleFrequency: 1 / 9,
  density: 0.5,
  radius: 4.5,
  maxFps: 30,
  lowPowerFps: 15,
} as const;

export type StarfieldAnimationPolicyInput = {
  active: boolean;
  appActive: boolean;
  reducedMotion: boolean;
  lowPowerMode?: boolean | null;
  thermalState?: string | null;
};

export function getMetalforgeStarfieldAnimationPolicy({
  active,
  appActive,
  reducedMotion,
  lowPowerMode = false,
  thermalState,
}: StarfieldAnimationPolicyInput): {
  shouldAnimate: boolean;
  fps: 15 | 30;
} {
  const normalizedThermal = thermalState?.toLowerCase() ?? '';
  const seriousHeat = normalizedThermal === 'serious' || normalizedThermal === 'critical';
  return {
    shouldAnimate: active && appActive && !reducedMotion && !seriousHeat,
    fps: lowPowerMode ? 15 : 30,
  };
}

const toRGBA = (hex: string): [number, number, number, number] => {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1];
};

const STAR_COLOR = toRGBA(METALFORGE_STARFIELD_PARAMETERS.starColor);

export type MetalforgeStarfieldProps = {
  /** Freeze the last animated frame when the parent screen is not visible. */
  active?: boolean;
  /** Optional native capability values; absent values fail open safely. */
  lowPowerMode?: boolean | null;
  thermalState?: string | null;
  style?: StyleProp<ViewStyle>;
};

export default function MetalforgeStarfield({
  active = true,
  lowPowerMode = false,
  thermalState,
  style,
}: MetalforgeStarfieldProps) {
  const reducedMotion = useReducedMotion();
  const [{ width, height }, setSize] = useState({ width: 1, height: 1 });
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const elapsed = useSharedValue(0);
  const lastFrameAt = useSharedValue(-1);
  const frameAccumulatorMs = useSharedValue(0);
  const animationPolicy = getMetalforgeStarfieldAnimationPolicy({
    active,
    appActive,
    reducedMotion,
    lowPowerMode,
    thermalState,
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  const frame = useFrameCallback(({ timestamp, timeSincePreviousFrame }) => {
    if (!animationPolicy.shouldAnimate) return;
    const now = timestamp ?? 0;
    const intervalMs = 1_000 / animationPolicy.fps;
    const deltaMs = lastFrameAt.value >= 0 && now > 0
      ? Math.min(now - lastFrameAt.value, 100)
      : Math.min(timeSincePreviousFrame ?? 0, 100);
    if (now > 0) {
      if (lastFrameAt.value >= 0 && now - lastFrameAt.value < intervalMs) return;
      lastFrameAt.value = now;
    } else {
      // Expo Go / partial runtimes may omit timestamps. The elapsed-time
      // accumulator keeps the same 30/15 FPS cap without a native dependency.
      frameAccumulatorMs.value += deltaMs;
      if (frameAccumulatorMs.value < intervalMs) return;
      frameAccumulatorMs.value %= intervalMs;
    }
    elapsed.value += deltaMs / 1000;
  }, false);
  useEffect(() => {
    if (animationPolicy.shouldAnimate) {
      lastFrameAt.value = -1;
      frameAccumulatorMs.value = 0;
    }
    frame.setActive(animationPolicy.shouldAnimate);
    return () => frame.setActive(false);
  }, [animationPolicy.shouldAnimate, frame, frameAccumulatorMs, lastFrameAt]);

  const uniforms = useDerivedValue(() => ({
    size: [width, height],
    time: reducedMotion ? 0 : elapsed.value,
    speed: METALFORGE_STARFIELD_PARAMETERS.speed * METALFORGE_STARFIELD_RUNTIME_FACTORS.speed,
    twinkleSpeed: METALFORGE_STARFIELD_PARAMETERS.twinkleSpeed * METALFORGE_STARFIELD_RUNTIME_FACTORS.twinkleFrequency,
    twinkleAmount: METALFORGE_STARFIELD_PARAMETERS.twinkleAmount,
    layers: METALFORGE_STARFIELD_PARAMETERS.layers,
    baseScale: METALFORGE_STARFIELD_PARAMETERS.baseScale,
    scaleStep: METALFORGE_STARFIELD_PARAMETERS.scaleStep,
    density: METALFORGE_STARFIELD_PARAMETERS.density * METALFORGE_STARFIELD_RUNTIME_FACTORS.density,
    starSize: METALFORGE_STARFIELD_PARAMETERS.starSize,
    radiusScale: METALFORGE_STARFIELD_RUNTIME_FACTORS.radius,
    starColor: STAR_COLOR,
  }), [height, reducedMotion, width]);

  return (
    <View
      onLayout={({ nativeEvent }) => setSize(nativeEvent.layout)}
      pointerEvents="none"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, styles.container, style]}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <Shader source={starfieldSkSL} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    // The parent owns the glass/material surface; particles are the first,
    // pointer-transparent layer inside it and never cover foreground content.
    zIndex: 0,
  },
});

/* Usage:
   <View style={{ flex: 1, backgroundColor: '#020208' }}>
     <MetalforgeStarfield />
     {children}
   </View>
*/
