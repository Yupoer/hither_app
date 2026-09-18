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
  useWindowDimensions,
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
uniform half4 starColor;
uniform half4 background;

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
  half3 result = background.rgb;
  float activeLayers = clamp(layers, 0.0, 5.0);
  float probability = clamp(density, 0.0, 1.0);

  // Five fixed iterations keep the shader compatible with SkSL; the uniform
  // controls how many of those layers contribute to the final image.
  for (int i = 0; i < 5; i++) {
    float layer = float(i);
    if (layer < activeLayers) {
      float scale = max(4.0, (baseScale + layer * scaleStep) * 0.20);
      float2 layerPoint = point * scale;
      layerPoint.y += time * speed * (0.18 + layer * 0.08);
      layerPoint.x += sin(time * 0.05 + layer * 4.0) * 0.05;

      float2 cell = floor(layerPoint);
      float2 local = fract(layerPoint) - 0.5;
      float2 seed = cell + float2(layer * 17.0, layer * 31.0);
      float present = step(1.0 - probability, hash21(seed));
      float2 jitter = hash22(seed + float2(13.0, 29.0)) - 0.5;
      float2 delta = local - jitter * 0.70;

      float radius = mix(0.004, 0.028, hash21(seed + float2(7.0, 19.0)));
      radius *= 0.70 + starSize * 3.0;
      float distanceToStar = length(delta);
      float core = 1.0 - smoothstep(radius * 0.25, radius, distanceToStar);
      float halo = 1.0 - smoothstep(radius, radius * 3.0, distanceToStar);
      float phase = hash21(seed + float2(23.0, 47.0)) * 6.2831853;
      float twinkle = 1.0 + sin(time * twinkleSpeed * (0.65 + layer * 0.18) + phase) * twinkleAmount;
      float intensity = present * (core + halo * 0.12) * max(0.0, twinkle);

      result += starColor.rgb * half(intensity);
    }
  }

  return half4(clamp(result, half3(0.0), half3(1.0)), 1.0);
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

const toRGBA = (hex: string): [number, number, number, number] => {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1];
};

const STAR_COLOR = toRGBA(METALFORGE_STARFIELD_PARAMETERS.starColor);
const BACKGROUND_COLOR = toRGBA(METALFORGE_STARFIELD_PARAMETERS.background);

export type MetalforgeStarfieldProps = {
  /** Freeze the last animated frame when the parent screen is not visible. */
  active?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function MetalforgeStarfield({ active = true, style }: MetalforgeStarfieldProps) {
  const reducedMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const elapsed = useSharedValue(0);
  const startTimestamp = useSharedValue(-1);
  const isActive = active && appActive && !reducedMotion;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useFrameCallback(({ timestamp }) => {
    if (!isActive || timestamp === undefined) return;
    if (startTimestamp.value < 0) startTimestamp.value = timestamp;
    elapsed.value = (timestamp - startTimestamp.value) / 1000;
  });

  const uniforms = useDerivedValue(() => ({
    size: [width, height],
    time: reducedMotion ? 0 : elapsed.value,
    speed: METALFORGE_STARFIELD_PARAMETERS.speed,
    twinkleSpeed: METALFORGE_STARFIELD_PARAMETERS.twinkleSpeed,
    twinkleAmount: METALFORGE_STARFIELD_PARAMETERS.twinkleAmount,
    layers: METALFORGE_STARFIELD_PARAMETERS.layers,
    baseScale: METALFORGE_STARFIELD_PARAMETERS.baseScale,
    scaleStep: METALFORGE_STARFIELD_PARAMETERS.scaleStep,
    density: METALFORGE_STARFIELD_PARAMETERS.density,
    starSize: METALFORGE_STARFIELD_PARAMETERS.starSize,
    starColor: STAR_COLOR,
    background: BACKGROUND_COLOR,
  }), [height, reducedMotion, width]);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFillObject, styles.container, style]}
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
  },
});

/* Usage:
   <View style={{ flex: 1, backgroundColor: '#020208' }}>
     <MetalforgeStarfield />
     {children}
   </View>
*/
