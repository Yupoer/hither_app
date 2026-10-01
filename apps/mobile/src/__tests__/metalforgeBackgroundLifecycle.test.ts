import React from 'react';
const mockFrames: any[] = [];
const mockUniforms: any[] = [];
jest.mock('react-native', () => ({
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
    if (!ref.current) { ref.current = { callback, setActive: jest.fn() }; mockFrames.push(ref.current); }
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
