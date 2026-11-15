import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import MotionPressable from '../components/MotionPressable';

jest.unmock('../components/MotionPressable');

const mockSpring = jest.fn((value: number, _config: unknown) => value);
const mockTiming = jest.fn((value: number, _config: unknown) => value);
let mockReducedMotion = false;
jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { flatten: (style: unknown) => style },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (value: number) => require('react').useState(() => ({ value }))[0],
  useAnimatedStyle: (callback: () => unknown) => callback(),
  useReducedMotion: () => mockReducedMotion,
  withSpring: (value: number, config: unknown) => mockSpring(value, config),
  withTiming: (value: number, config: unknown) => mockTiming(value, config),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  mockSpring.mockClear();
  mockTiming.mockClear();
  mockReducedMotion = false;
});

it('retracts the depth shadow on press and restores it with a spring on release', async () => {
  let tree!: ReactTestRenderer;
  const props = { motion: 'depth' as const, style: () => ({ opacity: 1 }) };
  await act(async () => { tree = create(React.createElement(MotionPressable, props)); });
  const button = () => tree.root.find(node => String(node.type) === 'Pressable');
  const animatedStyle = () => button().props.style[1];
  expect(animatedStyle().boxShadow[0].offsetY).toBe(4);
  await act(async () => button().props.onPressIn({}));
  expect(animatedStyle().transform).toEqual([{ translateY: 4 }]);
  expect(animatedStyle().boxShadow[0].offsetY).toBe(0);
  await act(async () => button().props.onPressOut({}));
  expect(mockSpring).toHaveBeenCalledWith(0, expect.objectContaining({ stiffness: 340, damping: 18 }));
  expect(animatedStyle().transform).toEqual([{ translateY: 0 }]);
  expect(animatedStyle().boxShadow[0].offsetY).toBe(4);
  await act(async () => tree.unmount());
});

it.each(['scale', 'fade', 'depth'] as const)('respects reduced motion for %s feedback', async motion => {
  mockReducedMotion = true;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(MotionPressable, { motion })); });
  const button = tree.root.find(node => String(node.type) === 'Pressable');
  await act(async () => { button.props.onPressIn({}); button.props.onPressOut({}); });
  expect(mockSpring).not.toHaveBeenCalled();
  expect(mockTiming).toHaveBeenLastCalledWith(0, { duration: 0 });
  await act(async () => tree.unmount());
});
