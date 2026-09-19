import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles },
  View: 'View',
}));

jest.mock('@shopify/react-native-skia', () => ({
  Canvas: 'Canvas',
  Fill: 'Fill',
  Shader: 'Shader',
  Skia: { RuntimeEffect: { Make: jest.fn(() => ({})) } },
}));

jest.mock('react-native-reanimated', () => ({
  useDerivedValue: jest.fn((factory: () => unknown) => ({ value: factory() })),
  useFrameCallback: jest.fn(() => ({ setActive: jest.fn() })),
  useReducedMotion: jest.fn(() => false),
  useSharedValue: jest.fn((value: unknown) => ({ value })),
}));

import {
  getMetalforgeStarfieldAnimationPolicy,
  METALFORGE_STARFIELD_RUNTIME_FACTORS,
} from '../components/MetalforgeStarfield';

const source = readFileSync(
  join(__dirname, '../components/MetalforgeStarfield.tsx'),
  'utf8',
);

describe('MetalforgeStarfield performance contract', () => {
  it('uses the requested runtime factors and transparent premultiplied shader', () => {
    expect(METALFORGE_STARFIELD_RUNTIME_FACTORS).toEqual({
      speed: 0.5,
      twinkleFrequency: 1 / 3,
      density: 0.5,
      radius: 1.5,
      maxFps: 30,
      lowPowerFps: 15,
    });
    expect(source).toContain('half3 result = half3(0.0)');
    expect(source).toContain('resultAlpha');
    expect(source).toContain('radiusScale');
    expect(source).toContain('sin(time * (speed / 1.2) * 0.05');
    expect(source).not.toContain('result = background.rgb');
    expect(source).toContain('pointerEvents="none"');
    expect(source).toContain('useFrameCallback');
    expect(source).toContain('const intervalMs = 1_000 / animationPolicy.fps');
    expect(source).toContain('now - lastFrameAt.value < intervalMs');
    expect(source).toContain('frameAccumulatorMs.value');
    expect(source).toContain('frame.setActive(animationPolicy.shouldAnimate)');
  });

  it('stops or downshifts from runtime constraints with a safe fallback', () => {
    expect(getMetalforgeStarfieldAnimationPolicy({
      active: true,
      appActive: true,
      reducedMotion: false,
    })).toEqual({ shouldAnimate: true, fps: 30 });
    expect(getMetalforgeStarfieldAnimationPolicy({
      active: true,
      appActive: true,
      reducedMotion: false,
      lowPowerMode: true,
    })).toEqual({ shouldAnimate: true, fps: 15 });
    expect(getMetalforgeStarfieldAnimationPolicy({
      active: true,
      appActive: true,
      reducedMotion: false,
      thermalState: 'serious',
    }).shouldAnimate).toBe(false);
    expect(getMetalforgeStarfieldAnimationPolicy({
      active: false,
      appActive: true,
      reducedMotion: false,
    }).shouldAnimate).toBe(false);
  });
});
