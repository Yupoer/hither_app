import React from 'react';
import { themes } from '../theme';
import { act, create } from 'react-test-renderer';

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', Modal: 'Modal',
  Platform: { OS: 'ios' }, Alert: { alert: jest.fn() },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {} },
  PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) },
  Animated: { View: 'Animated.View', Value: class { value = 0; setValue(v: number) { this.value = v; } } },
}));
jest.mock('../state/foregroundUi', () => ({ useForegroundUi: () => true, isForegroundUi: () => true }));
jest.mock('../state/PreferencesContext', () => ({ usePreferences: () => ({ dayColors: [], setDayColor: jest.fn() }) }));
jest.mock('../i18n', () => { const t = (key: string) => key; return { useTranslation: () => ({ t }) }; });
jest.mock('../utils/haptics', () => ({ lightTap: jest.fn(), mediumTap: jest.fn(), selectionTick: jest.fn() }));
jest.mock('../native', () => ({ liquidGlass: { GlassView: 'GlassView', isLiquidGlassAvailable: () => true } }));
jest.mock('../onboarding/sync', () => ({ readOnboardingState: () => Promise.resolve({}) }));
jest.mock('../screens/MapScreen/components/SettingsChildSheet', () => () => null);
jest.mock('../components/OverflowMarquee', () => 'Title');
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: 'DatePicker', DateTimePickerAndroid: {} }));
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({ __esModule: true, default: 'Swipeable' }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const DestinationReorderList = require('../components/DestinationReorderList').default;
const flatten = (s: any): any => Array.isArray(s) ? Object.assign({}, ...s.map(flatten)) : s ?? {};

it('keeps a floating drag clone, one empty-day insertion line, auto-scroll and cancellation', async () => {
  global.requestAnimationFrame = jest.fn((callback) => { callback(0); return 1; });
  global.cancelAnimationFrame = jest.fn();
  const onPreview = jest.fn(), onReorder = jest.fn(), onAutoScroll = jest.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, {
    destinations: [{ id: 'pool', title: 'Pool stop', day: null, order: 0, kind: 'stop', coordinates: { latitude: 25, longitude: 121 } }],
    canReorder: true, tripDays: 1, colors: { ...themes.night, accent: '#ffcc00' }, emptyLabel: 'empty',
    onDragPreviewChange: onPreview, onReorder, onDragAutoScroll: onAutoScroll,
  }), { createNodeMock: () => ({ measureInWindow: (cb: Function) => cb(20, 500, 350, 52) }) }); });
  const row = tree.root.findAll((n) => typeof n.props.onPanResponderGrant === 'function' && String(n.type) === 'Animated.View')[0];
  await act(async () => row.props.onPanResponderGrant({ nativeEvent: { pageX: 380 } }));
  const preview = onPreview.mock.calls.at(-1)![0];
  expect(preview.props.testID).toBe('route-drag-preview');
  expect(preview.props.pointerEvents).toBe('none');
  expect(flatten(preview.props.style).backgroundColor).toBe('#343B48');
  expect(preview.props.children.props.floating).toBe(true);
  let floatingTree!: ReturnType<typeof create>;
  await act(async () => { floatingTree = create(preview); });
  expect(floatingTree.root.findAllByType('Swipeable' as any)).toHaveLength(0);
  expect(floatingTree.root.findByType('Title' as any).props.text).toBe('Pool stop');
  expect(floatingTree.root.findAllByType('Text' as any).some(node => node.props.children === '≡')).toBe(true);
  await act(async () => { floatingTree.unmount(); });
  expect(flatten(preview.props.style)).toMatchObject({ left: 20, top: 500, width: 350, zIndex: 1000 });
  expect(flatten(row.parent!.parent!.props.style).opacity).toBe(0);
  await act(async () => row.props.onPanResponderMove({}, { dy: 300, moveY: 830 }));
  expect(flatten(preview.props.style).transform[0].translateY.value).toBe(300);
  expect(onAutoScroll).toHaveBeenCalledWith(expect.any(Number));
  const lines = tree.root.findAll((n) => String(n.type) === 'View' && flatten(n.props.style).backgroundColor === '#ffcc00' && flatten(n.props.style).height === 3);
  expect(lines).toHaveLength(1);
  await act(async () => row.props.onPanResponderTerminate());
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect(onReorder).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

it('lifts an entire day with its complete rows while leaving source geometry in place', async () => {
  const onPreview = jest.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, {
    destinations: [
      { id: 'a', title: 'Museum', address: 'Full address', day: 2, order: 0, kind: 'stop', coordinates: { latitude: 25, longitude: 121 } },
      { id: 'b', title: 'Hotel', day: 2, order: 1, kind: 'accommodation', coordinates: { latitude: 25, longitude: 121 } },
    ], canReorder: true, tripDays: 2, colors: themes.night, emptyLabel: 'empty',
    onDragPreviewChange: onPreview,
  }), { createNodeMock: () => ({ measureInWindow: (cb: Function) => cb(20, 400, 350, 160) }) }); });
  const findHeader = () => tree.root.findAll((node) => node.props.item?.id === 'header-2' && typeof node.props.onSwipeToggleAffordance === 'function')[0];
  await act(async () => { findHeader().props.onSwipeToggleAffordance(); });
  const header = findHeader();
  await act(async () => { header.props.onHeaderGrant(); });
  const preview = onPreview.mock.calls.at(-1)![0];
  const [previewHeader, previewRows] = preview.props.children.props.children;
  expect(previewHeader.props.item.id).toBe('header-2');
  expect(previewRows.map((row: any) => row.props.item.id)).toEqual(['a', 'b']);
  expect(previewRows.every((row: any) => row.props.floating)).toBe(true);
  const source = tree.root.findByProps({ testID: 'day-block-2' });
  expect(flatten(source.props.style).opacity).toBe(0);
  await act(async () => { header.props.onHeaderCancel(); });
  expect(onPreview).toHaveBeenLastCalledWith(null);
  await act(async () => tree.unmount());
});
