import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import {
  makeMutable,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';

// ─── MetalForge Grain SkSL Source ─────────────────────────────────────────────
const grainSkSL = Skia.RuntimeEffect.Make(`
uniform float2 size;
uniform float time;
uniform float speed;
uniform float flow;
uniform float grain;
uniform float brightness;
uniform half4 color1;
uniform half4 color2;
uniform half4 color3;
uniform half4 color4;
uniform half4 color5;
uniform half4 color6;
uniform half4 color7;
uniform half4 color8;
uniform half4 color9;

half3 ggColor(int i) {
    if (i == 0) return color1.rgb;
    if (i == 1) return color2.rgb;
    if (i == 2) return color3.rgb;
    if (i == 3) return color4.rgb;
    if (i == 4) return color5.rgb;
    if (i == 5) return color6.rgb;
    if (i == 6) return color7.rgb;
    return i == 7 ? color8.rgb : color9.rgb;
}

float ggH00(float x) { return 2.0 * x * x * x - 3.0 * x * x + 1.0; }
float ggH10(float x) { return x * x * x - 2.0 * x * x + x; }
float ggH01(float x) { return 3.0 * x * x - 2.0 * x * x * x; }
float ggH11(float x) { return x * x * x - x * x; }

float ggHermite(float p0, float p1, float m0, float m1, float x) {
    return p0 * ggH00(x) + m0 * ggH10(x) + p1 * ggH01(x) + m1 * ggH11(x);
}

int ggIndex(int x, int y) {
    int idx = y * 3 + x;
    if (idx < 0) return 0;
    if (idx > 8) return 8;
    return idx;
}

half3 ggGrid(float2 coords0, float t) {
    float a = sin(t * 1.0) * 0.5 + 0.5;
    float b = sin(t * 1.5) * 0.5 + 0.5;
    float c = sin(t * 2.0) * 0.5 + 0.5;
    float d = sin(t * 2.5) * 0.5 + 0.5;

    float y0 = mix(a, b, coords0.x);
    float y1 = mix(c, d, coords0.x);
    float x0 = mix(a, c, coords0.y);
    float x1 = mix(b, d, coords0.y);

    float cx = ggHermite(0.0, 1.0, flow * x0, flow * x1, coords0.x);
    float cy = ggHermite(0.0, 1.0, flow * y0, flow * y1, coords0.y);

    float2 gridCoords = float2(cx, cy) * 2.0;
    int idStartX = int(floor(gridCoords.x));
    int idStartY = int(floor(gridCoords.y));
    int idEndX   = int(ceil(gridCoords.x));
    int idEndY   = int(ceil(gridCoords.y));

    float2 factors = smoothstep(float2(0.0), float2(1.0), fract(gridCoords));

    half3 r0 = mix(ggColor(ggIndex(idStartX, idStartY)), ggColor(ggIndex(idEndX, idStartY)), factors.x);
    half3 r1 = mix(ggColor(ggIndex(idStartX, idEndY)),   ggColor(ggIndex(idEndX, idEndY)),   factors.x);
    return mix(r0, r1, factors.y);
}

half4 main(float2 fragCoord) {
    float2 uv01 = fragCoord / size;
    half3 col = ggGrid(uv01, time * speed * 0.20) * half(brightness);

    float x = (uv01.x + 4.0) * (uv01.y + 4.0) * 10.0;
    float g = mod((mod(x, 13.0) + 1.0) * (mod(x, 123.0) + 1.0), 0.01) - 0.005;
    col += half3(g * grain);

    return half4(clamp(col, half3(0.0), half3(1.0)), 1.0);
}
`)!;

// ─── Palette & Parameters ─────────────────────────────────────────────────────

export const METALFORGE_COLORS = [
  '#9A502B', '#83809B', '#002142',
  '#3A3F5E', '#04172E', '#BE5704',
  '#04172E', '#AD4F03', '#9B7683',
] as const;

export const METALFORGE_PARAMETERS = {
  speed: 0.8,
  flow: 1.7,
  grain: 13,
  brightness: 0.6,
} as const;

const toRGBA = (hex: string): [number, number, number, number] => {
  const num = parseInt(hex.replace('#', ''), 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255, 1];
};

// Pre-computed at module load — safe for UI-thread worklets
const COLOR_UNIFORMS = METALFORGE_COLORS.map(toRGBA) as [
  [number, number, number, number], [number, number, number, number], [number, number, number, number],
  [number, number, number, number], [number, number, number, number], [number, number, number, number],
  [number, number, number, number], [number, number, number, number], [number, number, number, number],
];
// ─── Continuous Global Animation Clock ────────────────────────────────────────
// Preserves animation time across screen transitions, mounts, and unmounts
const globalStartTime = makeMutable(-1);
const globalElapsedTime = makeMutable(0);

export type MetalforgeBackgroundProps = {
  /** False when the screen is not focused; animation freezes at its last frame. */
  active?: boolean;
};

/**
 * Full Metalforge grain shader rendered via React Native Skia.
 * Uses Hermite-interpolated 3×3 colour grid + procedural film grain
 * running at display refresh rate on the GPU.
 */
export default function MetalforgeBackground({ active = true }: MetalforgeBackgroundProps) {
  const reducedMotion = useReducedMotion();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const { width, height } = useWindowDimensions();
  const frozen = useSharedValue(0);
  const isActive = active && appActive && !reducedMotion;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useFrameCallback((frameInfo) => {
    if (!isActive) return;
    if (frameInfo.timestamp !== undefined && frameInfo.timestamp > 0) {
      if (globalStartTime.value < 0) {
        globalStartTime.value = frameInfo.timestamp;
      }
      globalElapsedTime.value = (frameInfo.timestamp - globalStartTime.value) / 1000;
    }
  });

  // When frozen (reduced motion), hold a static frame
  useEffect(() => {
    if (reducedMotion) {
      frozen.value = 0.5; // static mid-point
    }
  }, [frozen, reducedMotion]);

  const uniforms = useDerivedValue(() => ({
    size: [width, height],
    time: reducedMotion ? frozen.value : globalElapsedTime.value,
    speed: METALFORGE_PARAMETERS.speed,
    flow: METALFORGE_PARAMETERS.flow,
    grain: METALFORGE_PARAMETERS.grain,
    brightness: METALFORGE_PARAMETERS.brightness,
    color1: COLOR_UNIFORMS[0],
    color2: COLOR_UNIFORMS[1],
    color3: COLOR_UNIFORMS[2],
    color4: COLOR_UNIFORMS[3],
    color5: COLOR_UNIFORMS[4],
    color6: COLOR_UNIFORMS[5],
    color7: COLOR_UNIFORMS[6],
    color8: COLOR_UNIFORMS[7],
    color9: COLOR_UNIFORMS[8],
  }), [width, height, reducedMotion]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.container]} pointerEvents="none" accessibilityElementsHidden>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <Shader source={grainSkSL} uniforms={uniforms} />
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
