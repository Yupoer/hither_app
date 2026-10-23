import React from 'react';
const mockFrames: any[] = [];
const mockUniforms: any[] = [];
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 390, height: 844 }), View: 'View',
}));
jest.mock('@shopify/react-native-skia', () => ({
  Canvas: 'Canvas', Fill: 'Fill', Shader: 'Shader', Skia: { RuntimeEffect: { Make: () => ({}) } },
}));
jest.mock('react-native-reanimated', () => ({
  makeMutable: (value: unknown) => ({ value }),
  useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
  useReducedMotion: () => false,
  useDerivedValue: (factory: () => unknown) => {
    mockUniforms.push(factory); return { get value() { return factory(); } };
  },
  useFrameCallback: (callback: unknown) => {
    const ref = require('react').useRef(null);
    if (!ref.current) {
      const frame = { callback, isActive: false, registered: false, nativeActive: false,
        setActive: jest.fn((active: boolean) => {
          frame.isActive = active;
          if (frame.registered) frame.nativeActive = active;
        }) };
      ref.current = frame; mockFrames.push(frame);
    }
    const frame = ref.current;
    // Reanimated registers after child passive jobs and adopts the saved activation.
    require('../hooks/useMountEffect').useMountEffect(() => {
      frame.registered = true; frame.nativeActive = frame.isActive;
      return () => { frame.registered = false; frame.nativeActive = false; };
    });
    ref.current.callback = callback;
    return ref.current;
  },
}));
import { updateRuntimePowerState } from '../state/runtimePowerState';
import MetalforgeBackground from '../components/MetalforgeBackground';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('disables hidden frame callbacks and keeps hidden shader time independent of the visible screen', async () => {
  updateRuntimePowerState({ lowPowerMode: false, thermalState: 'nominal' });
  let root: any;
  const screens = (visible: boolean) => React.createElement(React.Fragment, null,
    React.createElement(MetalforgeBackground, { active: false }),
    React.createElement(MetalforgeBackground, { active: visible }),
  );
  await act(async () => { root = create(screens(true)); });
  expect(mockFrames[0].setActive).toHaveBeenLastCalledWith(false);
  expect(mockFrames[1].setActive).toHaveBeenLastCalledWith(true);
  expect(root.root.findAllByType('Canvas')).toHaveLength(1);
  const hiddenTime = mockUniforms[0]().time;
  mockFrames[1].callback({ timestamp: 1000 });
  mockFrames[1].callback({ timestamp: 1200 });
  expect(mockUniforms[1]().time).toBeCloseTo(0.2);
  expect(mockUniforms[0]().time).toBe(hiddenTime);
  await act(async () => { root.update(screens(false)); });
  expect(mockFrames[1].setActive).toHaveBeenLastCalledWith(false);
  expect(root.root.findAllByType('Canvas')).toHaveLength(0);
  await act(async () => { root.unmount(); });
  expect(mockFrames.every(frame => frame.setActive.mock.calls.at(-1)[0] === false)).toBe(true);
});

it('installs activation before native registration and retains its active state through Strict replay', async () => {
  mockFrames.length = 0; mockUniforms.length = 0;
  updateRuntimePowerState({ lowPowerMode: false, thermalState: 'nominal' });
  let root: any;
  const element = (active: boolean) => React.createElement(React.StrictMode, null,
    React.createElement(MetalforgeBackground, { active }));
  await act(async () => { root = create(element(true)); });
  const frame = mockFrames[0];
  expect(frame.registered).toBe(true);
  expect(frame.nativeActive).toBe(true);
  await act(async () => { root.update(element(false)); });
  expect(frame.nativeActive).toBe(false);
  expect(root.root.findAllByType('Canvas')).toHaveLength(0);
  await act(async () => { root.update(element(true)); });
  expect(frame.nativeActive).toBe(true);
  expect(mockFrames).toHaveLength(1);
  await act(async () => { root.unmount(); });
  expect(frame.registered).toBe(false);
  expect(frame.nativeActive).toBe(false);
});

it('caps active GPU frame updates and stops optional graphics at fair thermal pressure', async () => {
  mockFrames.length = 0; mockUniforms.length = 0;
  updateRuntimePowerState({ thermalState: 'nominal', lowPowerMode: false });
  let root: any;
  await act(async () => { root = create(React.createElement(MetalforgeBackground)); });
  const frame = mockFrames[0];
  frame.callback({ timestamp: 2000 });
  const start = mockUniforms[0]().time;
  frame.callback({ timestamp: 2020 });
  expect(mockUniforms[0]().time).toBe(start);
  frame.callback({ timestamp: 2050 });
  expect(mockUniforms[0]().time).toBeCloseTo(start + 0.05);
  await act(async () => { updateRuntimePowerState({ thermalState: 'fair', lowPowerMode: false }); });
  expect(frame.setActive).toHaveBeenLastCalledWith(false);
  await act(async () => { root.unmount(); });
});

it('retains the same frozen shader canvas under iOS system covers and resumes without replaying elapsed cover time', async () => {
  mockFrames.length = 0; mockUniforms.length = 0;
  updateRuntimePowerState({ lowPowerMode: false, thermalState: 'nominal' });
  const listeners = new Set<() => void>();
  const native = require('react-native').AppState;
  native.currentState = 'active';
  native.addEventListener = (_event: string, listener: () => void) => {
    listeners.add(listener); return { remove: () => listeners.delete(listener) };
  };
  const transition = (next: string) => {
    native.currentState = next;
    for (const listener of listeners) listener();
  };
  let root: any;
  await act(async () => { root = create(React.createElement(MetalforgeBackground)); });
  try {
    const canvas = root.root.findByType('Canvas');
    const frame = mockFrames[0];
    frame.callback({ timestamp: 1000 });
    frame.callback({ timestamp: 1100 });
    const frozenTime = mockUniforms[0]().time;
    for (let index = 0; index < 30; index += 1) {
      await act(async () => { transition('inactive'); });
      expect(root.root.findByType('Canvas')).toBe(canvas);
      expect(frame.setActive).toHaveBeenLastCalledWith(false);
      expect(mockUniforms[0]().time).toBe(frozenTime);
      await act(async () => { transition('active'); });
      expect(root.root.findByType('Canvas')).toBe(canvas);
      expect(frame.setActive).toHaveBeenLastCalledWith(true);
      frame.callback({ timestamp: 200_000 + index * 1000 });
      expect(mockUniforms[0]().time).toBe(frozenTime);
    }
    await act(async () => { transition('background'); });
    expect(root.root.findAllByType('Canvas')).toHaveLength(0);
    expect(frame.setActive).toHaveBeenLastCalledWith(false);
  } finally {
    await act(async () => { root.unmount(); });
    native.currentState = 'active';
  }
  expect(listeners.size).toBe(0);
});
