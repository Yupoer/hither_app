import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockGlassAvailable = jest.fn(() => true);
jest.mock('../native', () => ({ liquidGlass: { isLiquidGlassAvailable: () => mockGlassAvailable() } }));
jest.mock('react-native', () => ({
  Pressable: 'Pressable', View: 'View', Text: 'Text',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@expo/ui/swift-ui', () => ({ Host: 'Host', Button: 'Button', Image: 'Image' }));
jest.mock('@expo/ui/swift-ui/modifiers', () => Object.fromEntries([
  'accessibilityLabel', 'buttonBorderShape', 'buttonStyle', 'disabled', 'frame', 'glassEffect', 'labelStyle',
].map(name => [name, (value: unknown) => ({ name, value })])));

const HeaderAction = require('../components/SheetHeaderAction.ios').default;
const NativeSheetAction = require('../components/SheetHeaderActionContent.ios').default;
const flatten = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};

it.each([true, false])('uses one RN touch and accessibility target when Liquid Glass availability is %s', async glassAvailable => {
  mockGlassAvailable.mockReturnValue(glassAvailable);
  const onPress = jest.fn();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(HeaderAction, {
    action: 'commit', onPress, accessibilityLabel: '完成',
  })); });
  const target = tree.root.findByType('Pressable' as any);
  expect(tree.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityRole === 'button')).toHaveLength(1);
  expect(tree.root.findAll(node => typeof node.type === 'string' && typeof node.props.onPress === 'function')).toHaveLength(1);
  expect(target.props.accessibilityLabel).toBe('完成');
  expect(target.props.accessibilityState).toEqual({ disabled: false });
  expect(flatten(target.props.style({ pressed: false }))).toMatchObject({ width: 48, height: 48 });
  expect(flatten(target.props.style({ pressed: true })).opacity).toBe(0.82);
  await act(async () => target.props.onPress());
  expect(onPress).toHaveBeenCalledTimes(1);

  if (glassAvailable) {
    const decoration = tree.root.findByProps({ importantForAccessibility: 'no-hide-descendants' });
    expect(decoration.props).toMatchObject({ pointerEvents: 'none', accessible: false,
      accessibilityElementsHidden: true, collapsable: false });
    expect(tree.root.findByType('Host' as any).props.pointerEvents).toBe('none');
    expect(tree.root.findAllByType('Button' as any)).toHaveLength(0);
    expect(tree.root.findByType('Image' as any).props.modifiers).toContainEqual({ name: 'glassEffect',
      value: { glass: { variant: 'regular', interactive: false }, shape: 'circle' } });
  } else {
    expect(tree.root.findAllByType('Host' as any)).toHaveLength(0);
  }

  await act(async () => { tree.update(React.createElement(HeaderAction, {
    action: 'commit', onPress, accessibilityLabel: '完成', disabled: true,
  })); });
  const disabledTarget = tree.root.findByType('Pressable' as any);
  expect(disabledTarget.props.disabled).toBe(true);
  expect(disabledTarget.props.accessibilityState).toEqual({ disabled: true });
  await act(async () => disabledTarget.props.onPress?.());
  expect(onPress).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

it('updates the single target callback and label when an overlay changes from commit to close', async () => {
  mockGlassAvailable.mockReturnValue(true);
  const done = jest.fn();
  const close = jest.fn();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(HeaderAction, {
    action: 'commit', onPress: done, accessibilityLabel: '完成',
  })); });
  await act(async () => { tree.update(React.createElement(HeaderAction, {
    action: 'close', onPress: close, accessibilityLabel: '關閉',
  })); });
  const target = tree.root.findByType('Pressable' as any);
  expect(target.props.accessibilityLabel).toBe('關閉');
  expect(tree.root.findByType('Image' as any).props.systemName).toBe('xmark');
  await act(async () => target.props.onPress());
  expect(done).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

it('keeps the shared SwiftUI action interactive inside native settings sheets', async () => {
  const onPress = jest.fn();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(NativeSheetAction, {
    action: 'commit', onPress, accessibilityLabel: '完成',
  })); });
  await act(async () => tree.root.findByType('Button' as any).props.onPress());
  expect(onPress).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
