import React from 'react';
import { act, create } from 'react-test-renderer';
import BottomSheet from '../components/BottomSheet';
import SettingsSheetPanel from '../screens/MapScreen/components/SettingsSheetPanel';
import NativeSettingsChildSheet from '../screens/MapScreen/components/SettingsChildSheet.ios';
import { withSpring } from 'react-native-reanimated';
import { BottomSheet as NativeSheet } from '@expo/ui/swift-ui';

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable',
  StyleSheet: { absoluteFill: {}, create: (s: unknown) => s },
  useWindowDimensions: () => ({ height: 1000, width: 400 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('../components/BottomSheet', () => 'BottomSheet');
jest.mock('../components/SheetHeaderAction', () => 'HeaderAction');
jest.mock('../components/SheetHeaderActionContent.ios', () => 'HeaderAction');
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView' },
  useSharedValue: (value: number) => require('react').useState(() => ({ value }))[0],
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withSpring: jest.fn((value: number) => value), interpolate: () => 1, Extrapolation: { CLAMP: 'clamp' },
}));
jest.mock('@expo/ui/swift-ui', () => ({
  BottomSheet: 'NativeSheet', Group: 'Group', HStack: 'HStack', Host: 'Host', RNHostView: 'RNHostView',
  Spacer: 'Spacer', Text: 'SwiftText', VStack: 'VStack',
}));
jest.mock('@expo/ui/swift-ui/modifiers', () => ({
  frame: () => ({}), font: () => ({}), padding: () => ({}), presentationDetents: () => ({}), presentationDragIndicator: () => ({}),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('opens to new detents while preserving sheet/content owners through closing and reopen', async () => {
  const onDismissComplete = jest.fn();
  const props = { visible: false, title: 'settings', onClose: jest.fn(), onDismissComplete, children: React.createElement('div') };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(SettingsSheetPanel, props)); });
  expect(tree.root.findAllByType(BottomSheet)).toHaveLength(0);
  await act(async () => tree.update(React.createElement(SettingsSheetPanel, { ...props, visible: true })));
  const sheet = tree.root.findByType(BottomSheet);
  expect(sheet.props.height.value).toBe(520);
  await act(async () => sheet.props.onIndexChange(1));
  expect(tree.root.findByType(BottomSheet).props.index).toBe(1);
  const opened = (withSpring as jest.Mock).mock.calls.length;
  await act(async () => tree.update(React.createElement(SettingsSheetPanel, { ...props, visible: true })));
  expect((withSpring as jest.Mock).mock.calls).toHaveLength(opened);
  await act(async () => tree.update(React.createElement(SettingsSheetPanel, { ...props, visible: true, stageTwoRatio: 0.9, initialStage: 1 })));
  expect(tree.root.findByType(BottomSheet)).toBe(sheet);
  expect(sheet.props.index).toBe(1);
  expect(sheet.props.height.value).toBe(900);
  await act(async () => tree.update(React.createElement(SettingsSheetPanel, props)));
  expect(tree.root.findByType(BottomSheet)).toBe(sheet);
  expect(onDismissComplete).not.toHaveBeenCalled();
  await act(async () => sheet.props.onDismissComplete());
  expect(onDismissComplete).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType(BottomSheet)).toHaveLength(0);
  await act(async () => tree.update(React.createElement(SettingsSheetPanel, { ...props, visible: true })));
  expect(tree.root.findByType(BottomSheet).props.index).toBe(0);
  await act(async () => tree.unmount());
});

it('resets native close/dismiss ownership only when visibility changes', async () => {
  const onClose = jest.fn();
  const onDismissComplete = jest.fn();
  const props = { visible: false, title: 'settings', onClose, onDismissComplete, children: React.createElement('div') };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(NativeSettingsChildSheet, props)); });
  const sheet = () => tree.root.findByType(NativeSheet);
  await act(async () => sheet().props.onIsPresentedChange(false));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => tree.update(React.createElement(NativeSettingsChildSheet, { ...props, visible: true })));
  const owner = sheet();
  await act(async () => { sheet().props.onIsPresentedChange(false); sheet().props.onDismiss(); sheet().props.onDismiss(); });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onDismissComplete).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(React.createElement(NativeSettingsChildSheet, { ...props, visible: true })));
  await act(async () => sheet().props.onDismiss());
  expect(onDismissComplete).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(React.createElement(NativeSettingsChildSheet, props)));
  await act(async () => tree.update(React.createElement(NativeSettingsChildSheet, { ...props, visible: true })));
  expect(sheet()).toBe(owner);
  await act(async () => sheet().props.onDismiss());
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(onDismissComplete).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
});
