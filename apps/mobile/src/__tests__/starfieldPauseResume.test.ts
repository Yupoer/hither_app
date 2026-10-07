import React from 'react';
const mockListeners = new Set<() => void>();
const mockApp = { currentState: 'active', addEventListener: (_: string, cb: () => void) => {
  mockListeners.add(cb); return { remove: () => mockListeners.delete(cb) };
} };
const mockValues: { value: any }[] = [];
const mockFrames: any[] = [];
jest.mock('react-native', () => ({ AppState: mockApp, Platform: { OS: 'ios' },
  StyleSheet: { absoluteFill: {}, create: (value: unknown) => value }, View: 'View' }));
jest.mock('@shopify/react-native-skia', () => ({ Canvas: 'Canvas', Path: 'Path',
  Skia: { Path: { Make: () => ({ addCircle() {} }) } } }));
jest.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
  useSharedValue: (value: unknown) => {
    const ref = require('react').useRef(null);
    if (!ref.current) { ref.current = { value }; mockValues.push(ref.current); }
    return ref.current;
  },
  useDerivedValue: (factory: () => unknown) => ({ get value() { return factory(); } }),
  useFrameCallback: (callback: unknown) => {
    const ref = require('react').useRef(null);
    if (!ref.current) { ref.current = { callback, setActive: jest.fn() }; mockFrames.push(ref.current); }
    ref.current.callback = callback; return ref.current;
  },
}));
import MetalforgeStarfield from '../components/MetalforgeStarfield';
import { chargeBallsAt } from '../utils/starfieldParticles';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('freezes ball identity and phase through background time, and drains only while visible', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  const element = (emitting: boolean) => React.createElement(MetalforgeStarfield,
    { emitting, active: true, lowPowerMode: false, thermalState: 'nominal' });
  let tree: any;
  await act(async () => { tree = create(element(true)); });
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
  await act(async () => { tree.update(element(false)); });
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
  jest.useRealTimers();
});
