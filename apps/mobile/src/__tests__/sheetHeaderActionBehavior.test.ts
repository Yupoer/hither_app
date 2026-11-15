import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  MAP_SHEET_ACTION_HIT_SIZE,
  MAP_SHEET_ACTION_HALO,
  MAP_SHEET_ACTION_VISUAL_SIZE,
  MAP_SHEET_EDGE_INSET,
  MAP_FLOATING_GRABBER_HEIGHT,
  MAP_ISLAND_GRABBER_HEIGHT,
  MAP_ISLAND_HEIGHT,
  SHEET_CORNER_ACTION_INSET,
} from '../components/mapSheetChrome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockLightTap = jest.fn();
jest.mock('../utils/haptics', () => ({ lightTap: () => mockLightTap() }));
beforeEach(() => mockLightTap.mockClear());

const mockGlassAvailable = jest.fn(() => true);
jest.mock('../native', () => ({ liquidGlass: { isLiquidGlassAvailable: () => mockGlassAvailable() } }));
jest.mock('react-native', () => ({
  Pressable: 'Pressable', View: 'View', Text: 'Text',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@expo/ui/swift-ui', () => ({ Host: 'Host', Button: 'Button', Image: 'Image', Group: 'Group' }));
jest.mock('@expo/ui/swift-ui/modifiers', () => ({
  ...Object.fromEntries([
    'accessibilityLabel', 'buttonBorderShape', 'buttonStyle', 'contentShape', 'disabled',
    'font', 'foregroundColor', 'frame', 'glassEffect', 'labelStyle', 'offset', 'background', 'padding',
  ].map(name => [name, (value: unknown) => ({ name, value })])),
  shapes: { circle: () => ({ type: 'circle' }) },
}));

const HeaderAction = require('../components/SheetHeaderAction.ios').default;
const NativeSheetAction = require('../components/SheetHeaderActionContent.ios').default;

it.each([true, false])('uses a single SwiftUI button when Liquid Glass availability is %s', async glassAvailable => {
  mockGlassAvailable.mockReturnValue(glassAvailable);
  const onPress = jest.fn();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(HeaderAction, {
    action: 'commit', onPress, accessibilityLabel: '完成',
  })); });
  const target = tree.root.findByType('Button' as any);
  expect(tree.root.findAllByType('Pressable' as any)).toHaveLength(0);
  expect(tree.root.findAll(node => typeof node.type === 'string' && typeof node.props.onPress === 'function')).toHaveLength(1);
  expect(target.props.modifiers).toContainEqual({ name: 'accessibilityLabel', value: '完成' });
  expect(tree.root.findByType('Host' as any).props.style).toContainEqual(expect.objectContaining({
    width: MAP_SHEET_ACTION_HIT_SIZE + 2 * MAP_SHEET_ACTION_HALO,
    height: MAP_SHEET_ACTION_HIT_SIZE + 2 * MAP_SHEET_ACTION_HALO,
    margin: -MAP_SHEET_ACTION_HALO,
  }));
  expect(target.props.modifiers).toContainEqual({ name: 'frame', value: { width: MAP_SHEET_ACTION_VISUAL_SIZE, height: MAP_SHEET_ACTION_VISUAL_SIZE } });
  await act(async () => target.props.onPress());
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(mockLightTap).toHaveBeenCalledTimes(1);

  if (glassAvailable) {
    expect(target.props.modifiers).toContainEqual({ name: 'glassEffect',
      value: { glass: { variant: 'regular', interactive: true }, shape: 'circle' } });
  } else {
    expect(target.props.modifiers).toContainEqual({ name: 'buttonStyle', value: 'bordered' });
  }

  await act(async () => { tree.update(React.createElement(HeaderAction, {
    action: 'commit', onPress, accessibilityLabel: '完成', disabled: true,
  })); });
  const disabledTarget = tree.root.findByType('Button' as any);
  expect(disabledTarget.props.modifiers).toContainEqual({ name: 'disabled', value: true });
  expect(disabledTarget.props.onPress).toBeUndefined();
  expect(mockLightTap).toHaveBeenCalledTimes(1);
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
  const target = tree.root.findByType('Button' as any);
  expect(target.props.modifiers).toContainEqual({ name: 'accessibilityLabel', value: '關閉' });
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
    action: 'share', onPress, accessibilityLabel: '分享',
  })); });
  expect(tree.root.findByType('Image' as any).props.systemName).toBe('square.and.arrow.up');
  await act(async () => tree.root.findByType('Button' as any).props.onPress());
  expect(onPress).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

it('keeps 44pt targets while aligning smaller visuals 16pt from the sheet edge', () => {
  expect(MAP_SHEET_ACTION_HIT_SIZE).toBe(44);
  expect(MAP_SHEET_ACTION_VISUAL_SIZE).toBe(36);
  expect(SHEET_CORNER_ACTION_INSET + (MAP_SHEET_ACTION_HIT_SIZE - MAP_SHEET_ACTION_VISUAL_SIZE) / 2).toBe(MAP_SHEET_EDGE_INSET);
  expect([MAP_FLOATING_GRABBER_HEIGHT, MAP_ISLAND_GRABBER_HEIGHT, MAP_ISLAND_HEIGHT]).toEqual([32, 32, 106]);
});
