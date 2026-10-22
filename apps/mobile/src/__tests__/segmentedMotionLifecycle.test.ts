import React from 'react';
import { act, create } from 'react-test-renderer';
import { View } from 'react-native';
import { withTiming } from 'react-native-reanimated';
import { Segmented } from '../screens/MapScreen/components/Segmented';
const mockMotionWrites: unknown[] = [];
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: (s: unknown) => s },
}));
jest.mock('../a11y/useFontScaleBucket', () => ({ useFontLayout: () => ({ scale: 1, boldText: false }) }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView' }, Easing: { out: () => ({}), cubic: {} },
  useSharedValue: (initial: number) => require('react').useState(() => {
    let current: unknown = initial;
    return { get value() { return current; }, set value(next: unknown) { current = next; mockMotionWrites.push(next); } };
  })[0],
  useAnimatedStyle: (fn: () => unknown) => fn(), withTiming: jest.fn((value: number) => ({ timing: value })),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([false, true])('snaps appearing/resized tracks, animates selection, and retains its owner (StrictMode=%s)', async (strict) => {
  jest.clearAllMocks();
  mockMotionWrites.length = 0;
  const props = { options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], value: 'a', accent: '#fff', onChange: jest.fn() };
  const render = (value: string) => React.createElement(strict ? React.StrictMode : React.Fragment, null,
    React.createElement(Segmented, { ...props, value }));
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(render('a')); });
  const track = () => tree.root.findAllByType(View).find(node => typeof node.props.onLayout === 'function')!;
  const owner = track();
  const measure = async (width: number) => { await act(async () => track().props.onLayout({ nativeEvent: { layout: { width } } })); };
  const selected = () => tree.root.findByProps({ testID: 'segmented-tab-b' });
  await measure(300);
  expect(withTiming).not.toHaveBeenCalled();
  mockMotionWrites.length = 0;
  await act(async () => selected().props.onPress());
  expect(selected().props.accessibilityState.selected).toBe(true);
  expect(withTiming).toHaveBeenCalledTimes(1);
  expect(mockMotionWrites).toEqual([{ timing: 149 }]);
  mockMotionWrites.length = 0;
  await measure(400);
  expect(withTiming).toHaveBeenCalledTimes(1);
  expect(mockMotionWrites).toEqual([199]);
  await act(async () => tree.update(render('b')));
  mockMotionWrites.length = 0;
  await act(async () => tree.update(render('a')));
  expect(selected().props.accessibilityState.selected).toBe(false);
  expect(withTiming).toHaveBeenCalledTimes(2);
  expect(mockMotionWrites).toEqual([{ timing: 0 }]);
  await measure(0);
  await act(async () => selected().props.onPress());
  mockMotionWrites.length = 0;
  await measure(300);
  expect(withTiming).toHaveBeenCalledTimes(2);
  expect(mockMotionWrites).toEqual([149]);
  expect(track()).toBe(owner);
  await act(async () => tree.unmount());
});
