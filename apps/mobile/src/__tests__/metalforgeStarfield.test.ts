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
  it('uses the requested runtime factors with bounded batched paths instead of a full-surface shader', () => {
    expect(METALFORGE_STARFIELD_RUNTIME_FACTORS.maxFps).toBe(20);
    expect(source).not.toContain('RuntimeEffect');
    expect(source).toContain('pointerEvents="none"');
    expect(source).toContain('frame.setActive(policy.shouldAnimate)');
  });

  it('stops or downshifts from runtime constraints with a safe fallback', () => {
    expect(getMetalforgeStarfieldAnimationPolicy({
      active: true,
      appActive: true,
      reducedMotion: false,
    })).toEqual({ shouldAnimate: true, fps: 20 });
    expect(getMetalforgeStarfieldAnimationPolicy({
      active: true,
      appActive: true,
      reducedMotion: false,
      lowPowerMode: true,
    })).toEqual({ shouldAnimate: true, fps: 10 });
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

import { createStarfieldParticles } from '../utils/starfieldParticles';
it('reduces collapsed density to one third and doubles matched particle speed and radius', () => {
  const expanded = createStarfieldParticles(360, 100, false);
  const collapsed = createStarfieldParticles(360, 100, true);
  expect(Math.abs(collapsed.length - expanded.length / 3)).toBeLessThanOrEqual(3);
  for (const star of collapsed) {
    const original = expanded.find(other => other.x === star.x && other.y === star.y)!;
    expect(star.radius).toBeCloseTo(original.radius * 2);
    expect(star.velocity).toBeCloseTo(original.velocity * 2);
  }
  expect(createStarfieldParticles(0, 0, true)).toEqual([]);
});
