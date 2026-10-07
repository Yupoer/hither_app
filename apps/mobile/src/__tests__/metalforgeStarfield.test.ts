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
    expect(METALFORGE_STARFIELD_RUNTIME_FACTORS.maxFps).toBe(60);
    expect(source).not.toContain('RuntimeEffect');
    expect(source).toContain('pointerEvents="none"');
    expect(source).toContain('frame.setActive(policy.shouldAnimate)');
  });

  it('stops or downshifts from runtime constraints with a safe fallback', () => {
    expect(getMetalforgeStarfieldAnimationPolicy({
      active: true,
      appActive: true,
      reducedMotion: false,
      thermalState: 'nominal',
      lowPowerMode: false,
    })).toEqual({ shouldAnimate: true, fps: 60 });
    expect(getMetalforgeStarfieldAnimationPolicy({
      active: true,
      appActive: true,
      reducedMotion: false,
      thermalState: 'nominal',
      lowPowerMode: true,
    })).toEqual({ shouldAnimate: false, fps: 60 });
    expect(getMetalforgeStarfieldAnimationPolicy({
      active: true,
      appActive: true,
      reducedMotion: false,
      lowPowerMode: false,
      thermalState: 'serious',
    }).shouldAnimate).toBe(false);
    expect(getMetalforgeStarfieldAnimationPolicy({
      active: false,
      appActive: true,
      reducedMotion: false,
      thermalState: 'nominal',
      lowPowerMode: false,
    }).shouldAnimate).toBe(false);
  });
});

import { chargeBallsAt, changeChargeEmission, CHARGE_BALL_MAX_TRAVEL_MS, CHARGE_BALL_INTERVAL_MS } from '../utils/starfieldParticles';

it('starts outside the left edge and every new ball moves right at half the previous size', () => {
  expect(CHARGE_BALL_INTERVAL_MS).toBe(280 / 1.5 / 2);
  const windows = [{ startedAt: 0 }];
  const birth = chargeBallsAt(0, 360, windows)[0];
  expect(birth.x + birth.radius).toBe(0);
  let previous = chargeBallsAt(0, 360, windows);
  for (let now = 100; now < 15000; now += 100) {
    const current = chargeBallsAt(now, 360, windows);
    for (const ball of current) {
      const earlier = previous.find(item => item.id === ball.id);
      if (earlier) expect(ball.x).toBeGreaterThan(earlier.x);
      else {
        const bornAt = Number(ball.id.split(':')[1]) * CHARGE_BALL_INTERVAL_MS;
        const atBirth = chargeBallsAt(bornAt, 360, windows).find(item => item.id === ball.id)!;
        expect(atBirth.x + atBirth.radius).toBeCloseTo(0);
        expect(ball.x).toBeLessThan(380 * 100 / 4000);
      }
    }
    expect(current.length).toBeLessThanOrEqual(59);
    expect(current.every(ball => ball.radius >= 2 && ball.radius <= 3.2)).toBe(true);
    previous = current;
  }
  expect(chargeBallsAt(1000, 0, windows)).toEqual([]);
});

it('emits twice as many balls over the same time window', () => {
  const oldInterval = 280 / 1.5;
  const stoppedAt = oldInterval * 6;
  const balls = chargeBallsAt(stoppedAt, 360, [{ startedAt: 0, stoppedAt }]);
  expect(balls).toHaveLength(12);
});

it.each([320, 360, 720])('covers every height band once per 12 births at width %s', width => {
  const windows = [{ startedAt: 123 }];
  const fieldHeight = width * 0.85;
  for (let batch = 0; batch < 10; batch++) {
    const bands: number[] = [];
    for (let offset = 0; offset < 12; offset++) {
      const index = batch * 12 + offset;
      const birth = chargeBallsAt(123 + index * CHARGE_BALL_INTERVAL_MS, width, windows)
        .find(ball => ball.id === `123:${index}`)!;
      bands.push(Math.floor((birth.y - birth.radius) / (fieldHeight - birth.radius * 2) * 12));
    }
    expect(bands.sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, index) => index));
  }
});

it('keeps one full field across collapse; hidden lower balls keep moving', () => {
  const windows = [{ startedAt: 0 }];
  const expanded = chargeBallsAt(5000, 360, windows);
  const collapsed = expanded.filter(ball => ball.y - ball.radius < 70);
  const lower = expanded.find(ball => ball.y - ball.radius > 70 && ball.x < 240)!;
  expect(collapsed.length).toBeLessThan(expanded.length);
  expect(lower).toBeDefined();
  const later = chargeBallsAt(5300, 360, windows);
  expect(later.find(ball => ball.id === lower.id)!.x).toBeGreaterThan(lower.x);
  for (const ball of collapsed) expect(expanded.find(item => item.id === ball.id)).toEqual(ball);
  expect(source).not.toContain('collapsed');
});

it('closes only the inlet, preserves in-flight balls and drains naturally to the right', () => {
  const running = changeChargeEmission([], true, 0);
  const stopped = changeChargeEmission(running, false, 1500);
  const atStop = chargeBallsAt(1500, 360, stopped);
  expect(atStop).toEqual(chargeBallsAt(1500, 360, running));
  const afterStop = chargeBallsAt(2300, 360, stopped);
  expect(afterStop.map(ball => ball.id)).toEqual(atStop.map(ball => ball.id));
  expect(afterStop.every(ball => ball.x > atStop.find(item => item.id === ball.id)!.x)).toBe(true);
  expect(chargeBallsAt(1500 + CHARGE_BALL_MAX_TRAVEL_MS, 360, stopped)).toEqual([]);
  expect(changeChargeEmission(stopped, false, 1500 + CHARGE_BALL_MAX_TRAVEL_MS)).toEqual([]);
});

it('can resume the inlet while the previous batch is still draining', () => {
  const stopped = changeChargeEmission([{ startedAt: 0 }], false, 1500);
  const resumed = changeChargeEmission(stopped, true, 1600);
  const old = chargeBallsAt(1700, 360, stopped);
  const combined = chargeBallsAt(1700, 360, resumed);
  for (const ball of old) expect(combined.find(item => item.id === ball.id)).toEqual(ball);
  const newBall = chargeBallsAt(1600, 360, resumed).find(ball => ball.id === '1600:0')!;
  expect(newBall.x + newBall.radius).toBe(0);
});

import { advanceStarfieldPhase, advanceStarfieldPosition } from '../utils/starfieldPhase';
it('wraps particle positions and twinkle without an end frame and pauses without advancing', () => {
  let position = 399.9;
  let phase = 0.9999;
  for (let index = 0; index < 100_000; index++) {
    position = advanceStarfieldPosition(position, 100, 7.3, 400);
    phase = advanceStarfieldPhase(phase, 100);
    if (position < 0 || position >= 400 || phase < 0 || phase >= 1) throw new Error('unbounded particle state');
  }
  expect(advanceStarfieldPosition(position, 0, 7.3, 400)).toBe(position);
  expect(advanceStarfieldPosition(position, 50, 7.3, 400)).not.toBe(position);
  expect(advanceStarfieldPhase(phase, 0)).toBe(phase);
});

 it('moves 1.25 times the previous speed and twinkles independently on a slow cycle', () => {
  const windows = [{ startedAt: 0 }];
  const birth = chargeBallsAt(0, 360, windows)[0];
  const later = chargeBallsAt(1000, 360, windows).find(ball => ball.id === birth.id)!;
  const variation = (birth.radius / 0.4 - 5) / 3;
  expect((later.x - birth.x) / (360 + 2 * birth.radius / 0.4)).toBeCloseTo(1000 * 1.25 / (5000 + variation * 1800));
  const shades = Array.from({ length: 16 }, (_, index) => chargeBallsAt(index * 200, 360, windows)[0].shade);
  expect(new Set(shades).size).toBeGreaterThan(8);
  const field = chargeBallsAt(3000, 360, windows);
  expect(new Set(field.map(ball => ball.shade)).size).toBeGreaterThan(4);
  expect(source).not.toContain('highlight');
  expect(source).not.toContain('rim.addCircle');
 });
