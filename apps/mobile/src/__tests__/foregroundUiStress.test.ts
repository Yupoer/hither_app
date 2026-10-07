import React from 'react';
const mockListeners = new Set<(state: string) => void>();
const mockEvents = new Map<string, any>();
const mockPlatform = { OS: 'ios' };
const mockAppState = { currentState: 'active', addEventListener: jest.fn((event: string, listener: (state: string) => void) => {
  mockListeners.add(listener);
  mockEvents.set(event, listener);
  return { remove: () => { mockEvents.delete(event); mockListeners.delete(listener); } };
}) };
const mockFrames: any[] = [];
jest.mock('react-native', () => ({ AppState: mockAppState, Platform: mockPlatform,
  StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 390, height: 844 }), View: 'View',
}));
jest.mock('@shopify/react-native-skia', () => ({ Canvas: 'Canvas', Fill: 'Fill', Shader: 'Shader',
  Skia: { RuntimeEffect: { Make: () => ({}) } } }));
jest.mock('react-native-reanimated', () => ({
  makeMutable: (value: unknown) => ({ value }),
  useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
  useReducedMotion: () => false,
  useDerivedValue: (factory: () => unknown) => ({ get value() { return factory(); } }),
  useFrameCallback: (callback: unknown) => {
    const ref = require('react').useRef(null);
    if (!ref.current) { ref.current = { callback, setActive: jest.fn() }; mockFrames.push(ref.current); }
    ref.current.callback = callback;
    return ref.current;
  },
}));
import { useForegroundClock, useForegroundUi, useVisibleUi, useOptionalVisuals, isForegroundUi, subscribeForegroundUi } from '../state/foregroundUi';
import { updateRuntimePowerState } from '../state/runtimePowerState';
import { energyObservability, __resetEnergyObservabilityForTests } from '../state/energyObservability';
import MetalforgeBackground from '../components/MetalforgeBackground';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
function transition(state: string) {
  mockAppState.currentState = state;
  for (const listener of mockListeners) listener(state);
}
function Clock() {
  const now = useForegroundClock(1000);
  const active = useForegroundUi();
  const visuals = useOptionalVisuals();
  const visible = useVisibleUi();
  return React.createElement('clock', { now, active, visible, visuals });
}
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] }); mockAppState.currentState = 'active'; mockFrames.length = 0;
  mockAppState.addEventListener.mockClear();
  mockPlatform.OS = 'ios';
  updateRuntimePowerState({ thermalState: 'nominal', lowPowerMode: false });
  __resetEnergyObservabilityForTests();
});
afterEach(() => { jest.useRealTimers(); });

it('stress pauses 12 concurrent canvases and clocks for 200 lock/resume cycles with bounded resources', async () => {
  let root: any;
  const children = Array.from({ length: 12 }, (_, i) => React.createElement(React.Fragment, { key: i },
    React.createElement(MetalforgeBackground), React.createElement(Clock)));
  await act(async () => { root = create(React.createElement(React.Fragment, null, ...children)); });
  expect(mockListeners.size).toBe(1);
  expect(mockAppState.addEventListener).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(12);
  for (let cycle = 0; cycle < 200; cycle++) {
    await act(async () => { transition('inactive'); transition('background'); transition('background'); });
    expect(root.root.findAllByType('Canvas')).toHaveLength(0);
    expect(energyObservability.workloadSnapshot().animatedCanvasCount).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    const before = root.root.findAllByType('clock')[0].props.now;
    await act(async () => { jest.advanceTimersByTime(120_000); });
    expect(root.root.findAllByType('clock')[0].props.now).toBe(before);
    await act(async () => { transition('active'); transition('active'); });
    expect(root.root.findAllByType('Canvas')).toHaveLength(12);
    expect(energyObservability.workloadSnapshot().animatedCanvasCount).toBe(12);
    expect(jest.getTimerCount()).toBe(12);
    expect(root.root.findAllByType('clock')[0].props.now).toBe(Date.now());
    expect(mockFrames).toHaveLength(12);
    expect(mockFrames.every(frame => frame.setActive.mock.calls.at(-1)[0] === true)).toBe(true);
  }
  await act(async () => { updateRuntimePowerState({ thermalState: 'fair', lowPowerMode: false }); });
  expect(mockFrames.every(frame => frame.setActive.mock.calls.at(-1)[0] === false)).toBe(true);
  expect(root.root.findAllByType('clock').every((clock: any) => clock.props.visuals === false)).toBe(true);
  await act(async () => { root.unmount(); });
  expect(jest.getTimerCount()).toBe(0);
  expect(mockListeners.size).toBe(0);
  expect(energyObservability.workloadSnapshot().shaderCanvasCount).toBe(0);
});

it('keeps unknown/inactive states stopped, supports disabled clocks and removes its last listener', async () => {
  let root: any;
  transition('unknown');
  expect(isForegroundUi()).toBe(false);
  const notify = jest.fn();
  const unsubscribe = subscribeForegroundUi(notify);
  transition('background'); expect(notify).toHaveBeenCalledTimes(1);
  transition('active'); transition('active'); expect(notify).toHaveBeenCalledTimes(2);
  function DisabledClock() { return React.createElement('clock', { now: useForegroundClock(1000, false) }); }
  await act(async () => { root = create(React.createElement(DisabledClock)); });
  expect(jest.getTimerCount()).toBe(0);
  unsubscribe(); expect(mockListeners.size).toBe(1);
  await act(async () => { root.unmount(); });
  expect(mockListeners.size).toBe(0);
  transition('active'); expect(isForegroundUi()).toBe(true);
});

it('resumes shader time without counting background time or multiplying concurrent clocks', async () => {
  let root: any;
  await act(async () => { root = create(React.createElement(React.Fragment, null,
    React.createElement(MetalforgeBackground), React.createElement(MetalforgeBackground))); });
  const uniforms = () => root.root.findAllByType('Shader').map((shader: any) => shader.props.uniforms.value.time);
  const started = uniforms();
  for (const frame of mockFrames) { frame.callback({ timestamp: 1000 }); frame.callback({ timestamp: 1100 }); }
  expect(uniforms()[0] - started[0]).toBeCloseTo(0.1);
  expect(uniforms()[1] - started[1]).toBeCloseTo(0.1);
  const frozen = uniforms();
  await act(async () => { transition('background'); });
  await act(async () => { transition('active'); });
  for (const frame of mockFrames) frame.callback({ timestamp: 200_000 });
  expect(uniforms()).toEqual(frozen);
  for (const frame of mockFrames) frame.callback({ timestamp: 200_050 });
  expect(uniforms()[0] - frozen[0]).toBeCloseTo(0.05);
  await act(async () => { root.unmount(); });
});

it('pauses Android UI on blur while AppState stays active and resumes focus once', () => {
  mockPlatform.OS = 'android';
  const notify = jest.fn();
  const unsubscribe = subscribeForegroundUi(notify);
  expect(isForegroundUi()).toBe(true);
  mockEvents.get('blur')?.(); mockEvents.get('blur')?.();
  expect(isForegroundUi()).toBe(false);
  mockEvents.get('change')?.('active');
  expect(isForegroundUi()).toBe(false);
  expect(notify).toHaveBeenCalledTimes(1);
  mockEvents.get('focus')?.(); mockEvents.get('focus')?.();
  expect(isForegroundUi()).toBe(true);
  expect(notify).toHaveBeenCalledTimes(2);
  unsubscribe(); expect(mockListeners.size).toBe(0);
});

it('keeps visible backgrounds under a system sheet, freezes normal motion and stops both in background', async () => {
  let root: any;
  await act(async () => { root = create(React.createElement(React.Fragment, null,
    React.createElement(MetalforgeBackground),
    React.createElement(MetalforgeBackground, { allowInactive: true }),
  )); });
  expect(mockListeners.size).toBe(1);
  await act(async () => { transition('inactive'); });
  expect(root.root.findAllByType('Canvas')).toHaveLength(2);
  expect(mockFrames[0].setActive).toHaveBeenLastCalledWith(false);
  expect(mockFrames[1].setActive).toHaveBeenLastCalledWith(true);
  await act(async () => { transition('background'); });
  expect(root.root.findAllByType('Canvas')).toHaveLength(0);
  expect(mockFrames[1].setActive).toHaveBeenLastCalledWith(false);
  await act(async () => { transition('active'); updateRuntimePowerState({ lowPowerMode: true, thermalState: 'nominal' }); });
  expect(mockFrames[1].setActive).toHaveBeenLastCalledWith(false);
  await act(async () => { root.unmount(); });
  expect(mockListeners.size).toBe(0);
});


it('keeps iOS visible UI and its clock through a system cover while optional visuals pause', async () => {
  let root: any;
  await act(async () => { root = create(React.createElement(Clock)); });
  const started = root.root.findByType('clock').props.now;
  await act(async () => { transition('inactive'); });
  expect(root.root.findByType('clock').props).toMatchObject({ active: false, visible: true, visuals: false });
  expect(jest.getTimerCount()).toBe(1);
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(root.root.findByType('clock').props.now).toBe(started + 2000);
  await act(async () => { transition('active'); });
  expect(root.root.findByType('clock').props).toMatchObject({ active: true, visible: true, visuals: true });
  await act(async () => { transition('background'); });
  expect(root.root.findByType('clock').props.visible).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => { root.unmount(); });
});
