import React from 'react';
import { themes } from '../theme';
import { act, create } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Destination } from '../types';

let mockForeground = true;
const mockReadOnboarding = jest.fn();

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', Modal: 'Modal',
  Platform: { OS: 'ios' }, Alert: { alert: jest.fn() },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {} },
  PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) },
  Animated: { View: 'Animated.View', Value: class { value = 0; setValue(v: number) { this.value = v; } } },
}));
jest.mock('../state/foregroundUi', () => ({ useForegroundUi: () => mockForeground, isForegroundUi: () => mockForeground }));
jest.mock('../state/PreferencesContext', () => ({ usePreferences: () => ({ dayColors: [], setDayColor: jest.fn() }) }));
jest.mock('../i18n', () => { const t = (key: string) => key; return { useTranslation: () => ({ t }) }; });
jest.mock('../utils/haptics', () => ({ lightTap: jest.fn(), mediumTap: jest.fn(), selectionTick: jest.fn() }));
jest.mock('../native', () => ({ liquidGlass: { GlassView: 'GlassView', isLiquidGlassAvailable: () => true } }));
jest.mock('../onboarding/sync', () => ({ readOnboardingState: () => mockReadOnboarding() }));
jest.mock('../screens/MapScreen/components/SettingsChildSheet', () => () => null);
jest.mock('../components/OverflowMarquee', () => 'Title');
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: 'DatePicker', DateTimePickerAndroid: {} }));
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({ __esModule: true, default: 'Swipeable' }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const DestinationReorderList = require('../components/DestinationReorderList').default;
const flatten = (s: any): any => Array.isArray(s) ? Object.assign({}, ...s.map(flatten)) : s ?? {};

beforeEach(() => {
  mockForeground = true;
  mockReadOnboarding.mockReset().mockResolvedValue({});
  jest.mocked(AsyncStorage.getItem).mockReset().mockResolvedValue(null);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

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

const routeStops = (): Destination[] => ['a', 'b'].map((id, order) => ({
  id, title: id.toUpperCase(), day: 1, order, kind: 'stop', coordinates: { latitude: 25, longitude: 121 },
}));
const routeRows = (tree: ReturnType<typeof create>) => tree.root.findAllByType('Title' as never).map(node => node.props.text);
const routeRow = (tree: ReturnType<typeof create>, id: string) => tree.root.findAll(node => node.props.item?.id === id && typeof node.props.onGrant === 'function')[0];

it('ends a background drag before a same-commit route projection and releases parent scrolling and pending auto-scroll', async () => {
  global.requestAnimationFrame = jest.fn(() => 99);
  global.cancelAnimationFrame = jest.fn();
  const onActive = jest.fn(), latestActive = jest.fn(), onPreview = jest.fn(), onAutoScroll = jest.fn();
  const initial = routeStops();
  const props = { destinations: initial, canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty',
    onDragActiveChange: onActive, onDragPreviewChange: onPreview, onDragAutoScroll: onAutoScroll };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, props),
    { createNodeMock: () => ({ measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(20, 500, 350, 52) }) }); });
  await act(async () => { routeRow(tree, 'a').props.onGrant('a'); });
  await act(async () => { routeRow(tree, 'a').props.onMove('a', 10, 830); });
  expect(onActive).toHaveBeenLastCalledWith(true);
  const reverse = initial.map(stop => ({ ...stop, order: 1 - stop.order }));
  await act(async () => { tree.update(React.createElement(DestinationReorderList, { ...props, destinations: reverse })); });
  expect(routeRows(tree)).toEqual(['A', 'B']);
  await act(async () => { tree.update(React.createElement(DestinationReorderList,
    { ...props, destinations: reverse, onDragActiveChange: latestActive })); });
  expect(global.cancelAnimationFrame).toHaveBeenCalledWith(99);
  expect(latestActive).not.toHaveBeenCalled();
  mockForeground = false;
  await act(async () => { tree.update(React.createElement(DestinationReorderList,
    { ...props, destinations: [...reverse], onDragActiveChange: latestActive })); });
  expect(latestActive).toHaveBeenLastCalledWith(false);
  expect(onActive).toHaveBeenLastCalledWith(true);
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect(global.cancelAnimationFrame).toHaveBeenCalledWith(99);
  expect(onAutoScroll).not.toHaveBeenCalled();
  expect(routeRows(tree)).toEqual(['B', 'A']);
  await act(async () => { tree.unmount(); });
});

it('closes the owned swipeable for interaction-mode changes without treating callback-only changes as a route projection', async () => {
  const props = { destinations: routeStops(), canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty' };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, props)); });
  const close = jest.fn();
  act(() => { routeRow(tree, 'a').props.onSwipeableOpen({ close }); });
  await act(async () => { tree.update(React.createElement(DestinationReorderList, { ...props, onDragActiveChange: jest.fn() })); });
  expect(close).not.toHaveBeenCalled();
  await act(async () => { tree.update(React.createElement(DestinationReorderList, { ...props, interactionMode: 'select' })); });
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => { tree.unmount(); });
});

it('retains the optimistic drop across stale parent arrays and unlocks only when the parent acknowledges its route shape', async () => {
  const initial = routeStops();
  let finish!: (accepted: boolean) => void;
  const reorder = jest.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const props = { destinations: initial, canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty', onReorder: reorder };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, props)); });
  const originalRow = routeRow(tree, 'a');
  await act(async () => { originalRow.props.onGrant('a'); originalRow.props.onMove('a', 100); });
  let release!: Promise<void>;
  act(() => { release = originalRow.props.onRelease(); });
  expect(routeRows(tree)).toEqual(['B', 'A']);
  expect(reorder).toHaveBeenCalledTimes(1);
  await act(async () => { finish(true); await release; });
  await act(async () => { tree.update(React.createElement(DestinationReorderList, { ...props, destinations: [...initial] })); });
  expect(routeRows(tree)).toEqual(['B', 'A']);
  const acknowledged = initial.map(stop => ({ ...stop, order: 1 - stop.order }));
  await act(async () => { tree.update(React.createElement(DestinationReorderList, { ...props, destinations: acknowledged })); });
  expect(routeRows(tree)).toEqual(['B', 'A']);
  expect(routeRow(tree, 'a')).toBe(originalRow);
  await act(async () => { tree.update(React.createElement(DestinationReorderList, { ...props, destinations: [...initial] })); });
  expect(routeRows(tree)).toEqual(['A', 'B']);
  await act(async () => { tree.unmount(); });
});

it('cancels an old account collapse read and preserves expanded rows under StrictMode replay and a new account', async () => {
  const reads: ((value: string | null) => void)[] = [];
  jest.mocked(AsyncStorage.getItem).mockImplementation(() => new Promise(resolve => { reads.push(resolve); }));
  const props = { destinations: routeStops(), canReorder: true, tripDays: 1, departureDate: '2026-10-22',
    accountId: 'a', groupId: 'g', colors: themes.night, emptyLabel: 'empty' };
  let tree!: ReturnType<typeof create>;
  const render = (accountId: string) => React.createElement(React.StrictMode, null,
    React.createElement(DestinationReorderList, { ...props, accountId }));
  await act(async () => { tree = create(render('a')); });
  expect(reads).toHaveLength(2);
  await act(async () => { tree.update(render('b')); });
  expect(reads).toHaveLength(4);
  await act(async () => { reads[3](null); reads[2](null); });
  await act(async () => { reads[1]('1'); reads[0]('1'); });
  expect(routeRows(tree)).toEqual(['A', 'B']);
  await act(async () => { tree.update(render('b')); });
  expect(reads).toHaveLength(4);
  await act(async () => { tree.unmount(); });
});

it('preserves onboarding callback identity triggers and the original uncancelled defaults completion', async () => {
  const reads: ((value: unknown) => void)[] = [];
  mockReadOnboarding.mockImplementation(() => new Promise(resolve => { reads.push(resolve); }));
  const first = jest.fn(), second = jest.fn();
  const props = { destinations: routeStops(), canReorder: true, colors: themes.night, emptyLabel: 'empty', onUpdateTripDetails: first };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, props)); });
  await act(async () => { tree.update(React.createElement(DestinationReorderList, { ...props, onUpdateTripDetails: second })); });
  expect(reads).toHaveLength(2);
  const stored = { completed: true, answers: { days: 3, departureDate: '2026-10-22T00:00:00Z' } };
  await act(async () => { reads[0](stored); });
  expect(first).toHaveBeenCalledWith(3, stored.answers.departureDate);
  expect(second).not.toHaveBeenCalled();
  await act(async () => { tree.unmount(); });
  await act(async () => { reads[1](stored); });
  expect(second).toHaveBeenCalledWith(3, stored.answers.departureDate);
});
