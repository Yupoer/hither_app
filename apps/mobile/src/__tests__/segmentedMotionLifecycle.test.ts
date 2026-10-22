import React from 'react';
import { act, create } from 'react-test-renderer';
import { View } from 'react-native';
import { withTiming } from 'react-native-reanimated';
import { Segmented } from '../screens/MapScreen/components/Segmented';
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: (s: unknown) => s },
}));
jest.mock('../a11y/useFontScaleBucket', () => ({ useFontLayout: () => ({ scale: 1, boldText: false }) }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView' }, Easing: { out: () => ({}), cubic: {} },
  useSharedValue: (value: number) => require('react').useState(() => ({ value }))[0],
  useAnimatedStyle: (fn: () => unknown) => fn(), withTiming: jest.fn((value: number) => value),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('snaps appearing/resized tracks, animates selection, and retains its owner across controlled updates', async () => {
  const props = { options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], value: 'a', accent: '#fff', onChange: jest.fn() };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(Segmented, props)); });
  const track = () => tree.root.findAllByType(View).find(node => typeof node.props.onLayout === 'function')!;
  const owner = track();
  const measure = async (width: number) => { await act(async () => track().props.onLayout({ nativeEvent: { layout: { width } } })); };
  const selected = () => tree.root.findByProps({ testID: 'segmented-tab-b' });
  await measure(300);
  expect(withTiming).not.toHaveBeenCalled();
  await act(async () => selected().props.onPress());
  expect(selected().props.accessibilityState.selected).toBe(true);
  expect(withTiming).toHaveBeenCalledTimes(1);
  await measure(400);
  expect(withTiming).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(React.createElement(Segmented, { ...props, value: 'b' })));
  await act(async () => tree.update(React.createElement(Segmented, props)));
  expect(selected().props.accessibilityState.selected).toBe(false);
  expect(withTiming).toHaveBeenCalledTimes(2);
  await measure(0);
  await act(async () => selected().props.onPress());
  await measure(300);
  expect(withTiming).toHaveBeenCalledTimes(2);
  expect(track()).toBe(owner);
  await act(async () => tree.unmount());
});
