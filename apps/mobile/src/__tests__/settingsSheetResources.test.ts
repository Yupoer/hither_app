import React from 'react';
import { act, create } from 'react-test-renderer';
import { ScrollView, View } from 'react-native';
import SheetHeaderAction from '../components/SheetHeaderAction';
import BottomSheet from '../components/BottomSheet';
import SettingsSheetPanel from '../screens/MapScreen/components/SettingsSheetPanel';
import NativeInviteMembersSheet from '../screens/MapScreen/components/InviteMembersSheet.ios';
import NativeSettingsChildSheet from '../screens/MapScreen/components/SettingsChildSheet.ios';
import { withSpring } from 'react-native-reanimated';
import SheetPresentation from '../components/SheetPresentation';

it.each([false, true])('keeps settings header actions below the top edge with compact=%s', async home => {
  const props: React.ComponentProps<typeof SettingsSheetPanel> = {
    visible: true, title: 'settings', onClose: jest.fn(), home, children: React.createElement('div'),
  };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(SettingsSheetPanel, props)); });
  const header = tree.root.findByType(BottomSheet).props.header;
  expect(header.props.style[1].paddingTop).toBeGreaterThanOrEqual(0);
  await act(async () => tree.unmount());
});

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable',
  StyleSheet: { absoluteFill: {}, create: (s: unknown) => s },
  useWindowDimensions: () => ({ height: 1000, width: 400 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 54, bottom: 34 }) }));
jest.mock('../components/BottomSheet', () => 'BottomSheet');
jest.mock('../components/SheetHeaderAction', () => 'HeaderAction');
jest.mock('../components/SheetPresentation', () => 'SheetPresentation');
jest.mock('../screens/MapScreen/components/SettingsChildSheet', () =>
  jest.requireActual('../screens/MapScreen/components/SettingsChildSheet.ios'));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView' },
  useSharedValue: (value: number) => require('react').useState(() => ({ value }))[0],
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withSpring: jest.fn((value: number) => value), interpolate: () => 1, Extrapolation: { CLAMP: 'clamp' },
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

it('calls native close and dismissal callbacks once per presentation', async () => {
  const onClose = jest.fn();
  const onDismissComplete = jest.fn();
  const props = { title: 'Settings', onClose, onDismissComplete, children: null };
  const render = (visible: boolean) => React.createElement(NativeSettingsChildSheet, { ...props, visible });
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(render(false)); });
  const sheet = tree.root.findByType(SheetPresentation);
  await act(async () => sheet.props.onDismiss());
  expect(onDismissComplete).not.toHaveBeenCalled();

  await act(async () => tree.update(render(true)));
  await act(async () => { sheet.props.onClose(); sheet.props.onClose(); });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onDismissComplete).not.toHaveBeenCalled();
  await act(async () => tree.update(render(false)));
  await act(async () => { sheet.props.onDismiss(); sheet.props.onDismiss(); });
  expect(onDismissComplete).toHaveBeenCalledTimes(1);

  await act(async () => tree.update(render(true)));
  expect(tree.root.findByType(SheetPresentation)).toBe(sheet);
  await act(async () => sheet.props.onDismiss());
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(onDismissComplete).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
});

it('keeps a stacked settings page at its own fixed detent with back and close in the corners', async () => {
  const onBack = jest.fn();
  const onClose = jest.fn();
  const props = {
    visible: true, singleStage: true, onClose, stageTwoRatio: 1,
    children: React.createElement('div', { 'data-testid': 'store-owner' }),
  };
  const render = (nested: boolean) => React.createElement(NativeSettingsChildSheet, {
    ...props, navigation: 'child', title: nested ? 'Coordination' : 'Team',
    scrollResetKey: nested ? 'coordination' : 'team', onBack: nested ? onBack : undefined,
  });
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(render(false)); });
  const sheet = tree.root.findByType(SheetPresentation);
  expect(sheet.props.detents).toEqual([{ fraction: 1 }]);
  expect(sheet.props.dismissDisabled).toBeUndefined();
  expect(tree.root.findAllByType(SheetHeaderAction).map(item => [item.props.action, item.props.testID]))
    .toEqual([['close', 'settings-child-back']]);

  await act(async () => tree.update(render(true)));
  expect(tree.root.findByType(SheetPresentation)).toBe(sheet);
  expect(sheet.props.detents).toEqual([{ fraction: 1 }]);
  expect(sheet.props.selection).toEqual({ fraction: 1 });
  const actions = tree.root.findAllByType(SheetHeaderAction);
  expect(actions.map(item => item.props.action)).toEqual(['back', 'close']);
  await act(async () => actions[0].props.onPress());
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => actions[1].props.onPress());
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

it('keeps nested native settings sheets outside the parent scroll view', async () => {
  const page = React.createElement('div', { key: 'page' });
  const nestedProps = {
    key: 'account', visible: false, testID: 'nested', title: 'Account', onClose: jest.fn(),
    children: null, wrapContentInScrollView: false,
  };
  const nested = React.createElement(NativeSettingsChildSheet, nestedProps);
  const parentProps = {
    visible: true, singleStage: true, testID: 'parent', title: 'Settings', onClose: jest.fn(),
    children: [page, nested],
  };
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(React.createElement(NativeSettingsChildSheet, parentProps));
  });
  const scroll = tree.root.findByType(ScrollView);
  expect(scroll.findByType('div')).toBeDefined();
  expect(scroll.findAllByType(SheetPresentation)).toHaveLength(0);
  const parent = tree.root.findAllByType(SheetPresentation).find(node => node.props.testID === 'parent');
  expect(parent?.findAllByType(SheetPresentation).some(node => node.props.testID === 'nested')).toBe(true);
  await act(async () => tree.unmount());
});

it('sizes an invite to the measured actions and keeps large content scrollable', async () => {
  const onClose = jest.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    // eslint-disable-next-line react/no-children-prop -- InviteMembersSheetProps requires children, which createElement's rest args do not satisfy for typing
    tree = create(React.createElement(NativeInviteMembersSheet, {
      visible: true, onClose, title: 'Invite members', accent: '#fff', doneLabel: 'Close',
      fitContent: true, children: React.createElement('InviteActions'),
    }));
  });
  const sheet = tree.root.findByType(SheetPresentation);
  const scroll = tree.root.findByType(ScrollView);
  const header = tree.root.findAllByType(View).find(node => typeof node.props.onLayout === 'function');
  expect(sheet.props.useSystemBackground).toBe(true);
  expect(sheet.props.detents).toEqual([{ fraction: 0.36 }]);
  expect(scroll.find(node => String(node.type) === 'InviteActions')).toBeDefined();
  await act(async () => {
    header?.props.onLayout({ nativeEvent: { layout: { height: 52 } } });
    scroll.props.onContentSizeChange(320, 185);
  });
  expect(sheet.props.detents).toEqual([{ height: 261 }]);
  await act(async () => scroll.props.onContentSizeChange(320, 1000));
  expect(sheet.props.detents).toEqual([{ fraction: 0.8 }]);
  expect(scroll.find(node => String(node.type) === 'InviteActions')).toBeDefined();
  await act(async () => sheet.props.onClose());
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
