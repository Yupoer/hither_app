import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import NativeGlassButton from '../components/NativeGlassButton.ios';
import FallbackButton from '../components/NativeGlassButton';

const mockLightTap = jest.fn();
jest.mock('../utils/haptics', () => ({ lightTap: () => mockLightTap() }));
jest.mock('react-native', () => ({
  Pressable: 'Pressable', Text: 'Text', StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('../native', () => ({ liquidGlass: { isLiquidGlassAvailable: () => true } }));
jest.mock('@expo/ui/swift-ui', () => Object.fromEntries(
  ['Host', 'Button', 'HStack', 'Image', 'Text', 'ZStack', 'Spacer'].map(name => [name, name]),
));
jest.mock('@expo/ui/swift-ui/modifiers', () => Object.fromEntries(
  ['accessibilityLabel', 'accessibilityHint', 'buttonStyle', 'buttonBorderShape', 'controlSize',
    'font', 'disabled', 'frame', 'foregroundColor', 'labelStyle', 'offset', 'padding', 'tint']
    .map(name => [name, (value: unknown) => ({ name, value })]),
));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => mockLightTap.mockClear());

it.each([
  { systemImage: 'xmark' },
  { label: '搜尋', layout: 'fill' },
  { label: '搜尋', systemImage: 'magnifyingglass', centerText: true },
  { label: '搜尋', fontSize: 17 },
  { label: '搜尋' },
] as const)('fires one light tap and action for button layout %j', async layout => {
  const onPress = jest.fn();
  let tree!: ReactTestRenderer;
  const props = { ...layout, onPress, accessibilityLabel: '搜尋' };
  await act(async () => { tree = create(React.createElement(NativeGlassButton, props)); });
  const button = () => tree.root.find(node => String(node.type) === 'Button');
  await act(async () => button().props.onPress());
  expect(mockLightTap).toHaveBeenCalledTimes(1);
  expect(onPress).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(React.createElement(NativeGlassButton, { ...props, disabled: true })));
  expect(button().props.onPress).toBeUndefined();
  expect(mockLightTap).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

it('fires one tap for the fallback button and suppresses disabled actions', async () => {
  let tree!: ReactTestRenderer;
  const onPress = jest.fn();
  const props = { label: '搜尋', accessibilityLabel: '搜尋', onPress };
  await act(async () => { tree = create(React.createElement(FallbackButton, props)); });
  const button = () => tree.root.find(node => String(node.type) === 'Pressable');
  await act(async () => button().props.onPress());
  expect(mockLightTap).toHaveBeenCalledTimes(1);
  expect(onPress).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(React.createElement(FallbackButton, { ...props, disabled: true })));
  expect(button().props.onPress).toBeUndefined();
  expect(mockLightTap).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
