import React from 'react';
const mockListeners = new Set<() => void>();
const mockApp = { currentState: 'active', addEventListener: (_: string, cb: () => void) => {
  mockListeners.add(cb); return { remove: () => mockListeners.delete(cb) };
} };
const mockValues: { value: any }[] = [];
const mockFrames: any[] = [];
let mockReducedMotion = false;
jest.mock('react-native', () => ({ AppState: mockApp, Platform: { OS: 'ios' },
  StyleSheet: { absoluteFill: {}, create: (value: unknown) => value }, View: 'View' }));
jest.mock('@shopify/react-native-skia', () => ({ Canvas: 'Canvas', Path: 'Path',
  Skia: { Path: { Make: () => {
    const circles: number[][] = [];
    return { circles, addCircle: (x: number, y: number, radius: number) => circles.push([x, y, radius]) };
  } } } }));
jest.mock('react-native-reanimated', () => ({
  useReducedMotion: () => mockReducedMotion,
  useSharedValue: (value: unknown) => {
    const ref = require('react').useRef(null);
    if (!ref.current) { ref.current = { value }; mockValues.push(ref.current); }
    return ref.current;
  },
  useDerivedValue: (factory: () => unknown) => ({ get value() { return factory(); } }),
  useFrameCallback: (callback: (frame: { timestamp: number }) => void, autostart = true) => {
    const React = require('react');
    const ref = React.useRef(null);
    if (!ref.current) {
      const frame = {
        isActive: autostart,
        registered: null as null | typeof callback,
        callback: (info: { timestamp: number }) => { if (frame.isActive) frame.registered?.(info); },
        setActive: jest.fn((active: boolean) => { frame.isActive = active; }),
      };
      ref.current = frame;
      mockFrames.push(frame);
    }
    // eslint-disable-next-line hither/no-react-effects -- Mirror Reanimated's callback registration and cleanup on dependency changes.
    React.useEffect(() => {
      const frame = ref.current;
      frame.registered = callback;
      frame.setActive(frame.isActive);
      return () => { frame.registered = null; };
    }, [callback, autostart]);
    return ref.current;
  },
}));
import MetalforgeStarfield from '../components/MetalforgeStarfield';
import { chargeBallsAt } from '../utils/starfieldParticles';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mockTrees: any[] = [];

beforeEach(() => {
  mockValues.length = 0;
  mockFrames.length = 0;
  mockApp.currentState = 'active';
  mockReducedMotion = false;
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
});
afterEach(async () => {
  await act(async () => { mockTrees.splice(0).forEach(tree => tree.unmount()); });
  mockListeners.clear();
  jest.useRealTimers();
});

it('freezes ball identity and phase through background time, and drains only while visible', async () => {
  const element = (emitting: boolean) => React.createElement(MetalforgeStarfield,
    { emitting, active: true, lowPowerMode: false, thermalState: 'nominal' });
  let tree: any;
  await act(async () => { tree = create(element(true)); });
  mockTrees.push(tree);
  await act(async () => { tree.root.findByType('View').props.onLayout({ nativeEvent: { layout: { width: 360 } } }); });
  const frame = mockFrames[0];
  frame.callback({ timestamp: 1000 });
  frame.callback({ timestamp: 1016.666 });
  expect(mockValues[1].value).toBeCloseTo(16.666);
  frame.callback({ timestamp: 1050 });
  const clock = mockValues[1];
  const before = chargeBallsAt(clock.value, 360, mockValues[0].value);
  const frozen = clock.value;
  await act(async () => { mockApp.currentState = 'background'; mockListeners.forEach(cb => cb()); });
  expect(frame.setActive).toHaveBeenLastCalledWith(false);
  expect(tree.root.findAllByType('Canvas')).toHaveLength(0);
  await act(async () => { jest.advanceTimersByTime(120000); });
  frame.callback({ timestamp: 200000 });
  expect(clock.value).toBe(frozen);
  await act(async () => { mockApp.currentState = 'active'; mockListeners.forEach(cb => cb()); });
  frame.callback({ timestamp: 200000 });
  expect(chargeBallsAt(clock.value, 360, mockValues[0].value)).toEqual(before);
  frame.callback({ timestamp: 200050 });
  expect(clock.value).toBe(frozen + 50);
  expect(chargeBallsAt(clock.value, 360, mockValues[0].value)[0].x).toBeGreaterThan(before[0].x);
  // The doubled population must all reach Skia, without a legacy 59-ball cap
  // or extra Canvas/Path components for each particle.
  for (let timestamp = 200100; timestamp <= 205100; timestamp += 50) frame.callback({ timestamp });
  const fullField = chargeBallsAt(clock.value, 360, mockValues[0].value);
  expect(fullField.length).toBeGreaterThan(59);
  expect(fullField.length).toBeLessThanOrEqual(121);
  const layers = tree.root.findAllByType('Path');
  expect(layers).toHaveLength(16);
  const circles = layers.flatMap((layer: any) => layer.props.path.value.circles);
  expect(circles).toHaveLength(fullField.length);
  for (const ball of fullField) expect(circles).toContainEqual([ball.x, ball.y, ball.radius]);
  await act(async () => { tree.update(element(false)); });
  expect(tree.root.findAllByType('Canvas')).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(1);
  await act(async () => { mockApp.currentState = 'background'; mockListeners.forEach(cb => cb()); });
  expect(jest.getTimerCount()).toBe(0);
  const stoppedWindows = mockValues[0].value;
  await act(async () => { jest.advanceTimersByTime(120000); });
  expect(mockValues[0].value).toBe(stoppedWindows);
  await act(async () => { mockApp.currentState = 'active'; mockListeners.forEach(cb => cb()); });
  for (let timestamp = 300000; timestamp <= 307000; timestamp += 50) frame.callback({ timestamp });
  await act(async () => { jest.advanceTimersByTime(7000); });
  expect(tree.root.findAllByType('Canvas')).toHaveLength(0);
  await act(async () => { tree.unmount(); });
  expect(jest.getTimerCount()).toBe(0);
});

const motionLimits = [
  { name: 'low power', lowPowerMode: true, thermalState: 'nominal', reducedMotion: false },
  { name: 'reduced motion', lowPowerMode: false, thermalState: 'nominal', reducedMotion: true },
  { name: 'thermal pressure', lowPowerMode: false, thermalState: 'serious', reducedMotion: false },
];

describe.each(motionLimits)('$name', limit => {
  it.each(['before End', 'during drain'])('retires ended balls when motion stops %s and never revives them', async timing => {
    const element = (emitting: boolean, limited: boolean) => {
      mockReducedMotion = limited && limit.reducedMotion;
      return React.createElement(MetalforgeStarfield, {
        emitting, active: true,
        lowPowerMode: limited && limit.lowPowerMode,
        thermalState: limited ? limit.thermalState : 'nominal',
      });
    };
    let tree: any;
    await act(async () => { tree = create(element(true, false)); });
    mockTrees.push(tree);
    await act(async () => { tree.root.findByType('View').props.onLayout({ nativeEvent: { layout: { width: 360 } } }); });
    const frame = mockFrames[0];
    frame.callback({ timestamp: 0 });
    frame.callback({ timestamp: 100 });
    expect(tree.root.findAllByType('Path').flatMap((layer: any) => layer.props.path.value.circles).length).toBeGreaterThan(0);

    if (timing === 'before End') await act(async () => { tree.update(element(true, true)); });
    await act(async () => { tree.update(element(false, timing === 'before End')); });
    if (timing === 'during drain') {
      expect(tree.root.findAllByType('Canvas')).toHaveLength(1);
      await act(async () => { tree.update(element(false, true)); });
    }
    expect(tree.root.findAllByType('Canvas')).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
    await act(async () => { jest.advanceTimersByTime(120000); });
    await act(async () => { tree.update(element(false, false)); });
    frame.callback({ timestamp: 200000 });
    frame.callback({ timestamp: 200100 });
    expect(tree.root.findAllByType('Canvas')).toHaveLength(0);

    await act(async () => { tree.update(element(true, false)); });
    frame.callback({ timestamp: 200200 });
    frame.callback({ timestamp: 200300 });
    expect(tree.root.findAllByType('Canvas')).toHaveLength(1);
    expect(tree.root.findAllByType('Path').flatMap((layer: any) => layer.props.path.value.circles).length).toBeGreaterThan(0);
  });
});

it('keeps the current callback active after rerender and resumes an inlet while the old balls drain', async () => {
  const element = (emitting: boolean, color = '#FFFFFF') => React.createElement(MetalforgeStarfield,
    { emitting, active: true, color, lowPowerMode: false, thermalState: 'nominal' });
  let tree: any;
  await act(async () => { tree = create(element(true)); });
  mockTrees.push(tree);
  await act(async () => { tree.root.findByType('View').props.onLayout({ nativeEvent: { layout: { width: 360 } } }); });
  const frame = mockFrames[0];
  frame.callback({ timestamp: 0 });
  frame.callback({ timestamp: 100 });
  await act(async () => { tree.update(element(false)); });
  const circles = () => tree.root.findAllByType('Path').flatMap((layer: any) => layer.props.path.value.circles);
  const stopped = circles();
  expect(stopped.length).toBeGreaterThan(0);
  await act(async () => { tree.update(element(false, '#AAAAAA')); });
  frame.callback({ timestamp: 200 });
  expect(circles()).toHaveLength(stopped.length);
  for (const [x, , radius] of stopped) expect(circles().some(([laterX, , laterRadius]: number[]) => laterRadius === radius && laterX > x)).toBe(true);
  await act(async () => { tree.update(element(true)); });
  frame.callback({ timestamp: 300 });
  expect(circles().length).toBeGreaterThan(stopped.length);
});

it.each(['background', 'inactive'])('preserves an End while %s until its foreground drain resumes', async hidden => {
  const element = (emitting: boolean, active = true, lowPowerMode = false) => React.createElement(MetalforgeStarfield,
    { emitting, active, lowPowerMode, thermalState: 'nominal' });
  let tree: any;
  await act(async () => { tree = create(element(true)); });
  mockTrees.push(tree);
  await act(async () => { tree.root.findByType('View').props.onLayout({ nativeEvent: { layout: { width: 360 } } }); });
  const frame = mockFrames[0];
  frame.callback({ timestamp: 0 });
  frame.callback({ timestamp: 100 });
  const circles = () => tree.root.findAllByType('Path').flatMap((layer: any) => layer.props.path.value.circles);
  const before = circles();
  expect(before.length).toBeGreaterThan(0);
  await act(async () => {
    if (hidden === 'background') {
      mockApp.currentState = 'background';
      mockListeners.forEach(cb => cb());
    } else tree.update(element(true, false));
  });
  await act(async () => { tree.update(element(false, hidden !== 'inactive')); });
  expect(tree.root.findAllByType('Canvas')).toHaveLength(0);
  await act(async () => { jest.advanceTimersByTime(120000); });
  await act(async () => {
    mockApp.currentState = 'active';
    mockListeners.forEach(cb => cb());
    tree.update(element(false));
  });
  expect(circles()).toEqual(before);
  frame.callback({ timestamp: 200000 });
  frame.callback({ timestamp: 200100 });
  expect(circles()).not.toEqual(before);
  for (let timestamp = 200200; timestamp <= 206000; timestamp += 100) frame.callback({ timestamp });
  await act(async () => { jest.advanceTimersByTime(6000); });
  expect(tree.root.findAllByType('Canvas')).toHaveLength(0);
});

it('retires a background End on returning to a foreground that prohibits motion', async () => {
  const element = (emitting: boolean, lowPowerMode = false) => React.createElement(MetalforgeStarfield,
    { emitting, active: true, lowPowerMode, thermalState: 'nominal' });
  let tree: any;
  await act(async () => { tree = create(element(true)); });
  mockTrees.push(tree);
  await act(async () => { mockApp.currentState = 'background'; mockListeners.forEach(cb => cb()); });
  await act(async () => { tree.update(element(false, true)); });
  await act(async () => { mockApp.currentState = 'active'; mockListeners.forEach(cb => cb()); });
  await act(async () => { tree.update(element(false)); });
  expect(tree.root.findAllByType('Canvas')).toHaveLength(0);
});
