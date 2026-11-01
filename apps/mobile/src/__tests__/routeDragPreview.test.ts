import React from 'react';
import { themes } from '../theme';
import { act, create } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Destination } from '../types';
import { dragTargetIndexFromOffset, reorderRowGeometry, sourceClosedReorderGeometry, type ReorderListEntry } from '../utils/accommodationSemantics';

let mockForeground = true;
let mockReducedMotion = false;
let mockHoldSettle = false;
let mockDelayPulses = false;
const mockExecutedPulses: number[] = [];
const mockSettleCallbacks: (() => void)[] = [];
const mockMotionConfigs: { kind: string; toValue?: number; duration?: number; delay?: number; fromValue?: number }[] = [];
const mockReadOnboarding = jest.fn();

jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => mockReducedMotion }));
jest.mock('react-native', () => {
  const animation = (value: { value?: number; setValue: (v: number) => void }, config: { toValue: number; duration?: number }, kind: string) => {
    mockMotionConfigs.push({ ...config, kind, fromValue: value.value });
    return { start: (done?: (result: { finished: boolean }) => void) => { if (kind === 'timing' && config.duration === 65) mockExecutedPulses.push(config.toValue); value.setValue(config.toValue); done?.({ finished: true }); }, stop: jest.fn() };
  };
  return ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', Modal: 'Modal',
  AccessibilityInfo: { announceForAccessibility: jest.fn() },
  Easing: { out: (fn: unknown) => fn, in: (fn: unknown) => fn, cubic: 'cubic', quad: 'quad', exp: 'exp' },
  Platform: { OS: 'ios' }, Alert: { alert: jest.fn() },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {} },
  PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) },
  Animated: {
    View: 'Animated.View',
    Value: class { value: number; constructor(v: number) { this.value = v; } setValue(v: number) { this.value = v; } stopAnimation() {} },
    add: (a: { value: number }, b: { value: number }) => ({ get value() { return a.value + b.value; } }),
    timing: (value: { setValue: (v: number) => void }, config: { toValue: number }) => animation(value, config, 'timing'),
    spring: (value: { setValue: (v: number) => void }, config: { toValue: number }) => animation(value, config, 'spring'),
    delay: (delay: number) => { mockMotionConfigs.push({ kind: 'delay', delay }); return { start: () => {} }; },
    sequence: (animations: { start: () => void }[]) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      return { start: () => {
        if (mockDelayPulses) timer = setTimeout(() => animations.forEach(item => item.start()), 72);
        else animations.forEach(item => item.start());
      }, stop: () => { if (timer != null) clearTimeout(timer); } };
    },
    parallel: (animations: { start: () => void }[]) => ({ start: (done: (result: { finished: boolean }) => void) => {
      animations.forEach(item => item.start());
      if (mockHoldSettle) mockSettleCallbacks.push(() => done({ finished: true })); else done({ finished: true });
    } }),
  },
}); });
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
  mockReducedMotion = false;
  mockHoldSettle = false;
  mockDelayPulses = false;
  mockExecutedPulses.length = 0;
  mockSettleCallbacks.length = 0;
  mockMotionConfigs.length = 0;
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
  const row = tree.root.findByProps({ testID: 'route-drag-handle-pool' });
  await act(async () => row.props.onPanResponderGrant({ nativeEvent: { pageX: 350, pageY: 526 } }));
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
  expect(routeRow(tree, 'pool').props.active).toBe(true);
  await act(async () => row.props.onPanResponderMove({}, { dy: 300, moveY: 830, dx: -25, moveX: 325 }));
  expect(flatten(preview.props.style).transform[1].translateY.value).toBe(300);
  expect(onAutoScroll).toHaveBeenCalledWith(expect.any(Number));
  const lines = tree.root.findAllByProps({ testID: 'route-insertion-line' });
  expect(lines).toHaveLength(1);
  expect(flatten(lines[0].props.style)).toMatchObject({ position: 'absolute', height: 1.5, opacity: 0.15, backgroundColor: themes.night.textPrimary });
  expect(flatten(preview.props.style).transform[0].translateX.value).toBe(-9);
  expect(flatten(preview.props.style).transform[2].scale.value).toBe(0.9);
  await act(async () => row.props.onPanResponderTerminate());
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect(onReorder).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

it('lifts only the day separator while preserving its destinations and native geometry', async () => {
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
  const previewHeader = preview.props.children.props.children;
  expect(previewHeader.props.item.id).toBe('header-2');
  expect(routeRow(tree, 'a').props.active).toBe(false);
  expect(routeRow(tree, 'b').props.active).toBe(false);
  expect(header.props.headerActive).toBe(true);
  const source = tree.root.findByProps({ testID: 'day-block-2' });
  expect(flatten(source.props.style).opacity).toBeUndefined();
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
  expect(routeRows(tree)).toEqual(['A', 'B']);
  expect(reorder).not.toHaveBeenCalled();
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

it('projects measured rows around the removed source and retains original insertion boundaries across hidden rows', () => {
  const entries: ReorderListEntry[] = [
    { type: 'header', id: 'h1', day: 1 },
    { type: 'dest', id: 'a', day: 1, kind: 'stop' },
    { type: 'dest', id: 'b', day: 1, kind: 'stop' },
    { type: 'header', id: 'h2', day: 2 },
    { type: 'dest', id: 'hidden', day: 2, kind: 'stop' },
    { type: 'header', id: 'h3', day: 3 },
  ];
  const measured = { heightById: new Map([['h1', 40], ['a', 80], ['b', 30], ['h2', 60], ['hidden', 0], ['h3', 50]]),
    gapByDay: new Map([[1, 20], [2, 0], [3, 0]]) };
  const frozen = reorderRowGeometry(entries, undefined, measured);
  expect(sourceClosedReorderGeometry(frozen, 1)).toEqual({ tops: [0, 40, 40, 90, 150, 150], rowHeights: [40, 0, 30, 60, 0, 50], total: 200 });
  expect(frozen.tops).toEqual([0, 40, 120, 170, 230, 230]);
  expect(dragTargetIndexFromOffset(entries, 1, 0, undefined, measured, true)).toBe(2);
  expect(dragTargetIndexFromOffset(entries, 1, 20, undefined, measured, true)).toBe(3);
  expect(dragTargetIndexFromOffset(entries, 1, 115, undefined, measured, true)).toBe(5);
});

it('keeps the clone through settling, commits once, and rolls back a rejected persistence result', async () => {
  mockHoldSettle = true;
  const onPreview = jest.fn(), reorder = jest.fn().mockResolvedValue(false);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, {
    destinations: routeStops(), canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty',
    onDragPreviewChange: onPreview, onReorder: reorder,
  }), { createNodeMock: () => ({ measureInWindow: (callback: Function) => callback(20, 100, 350, 600) }) }); });
  const row = routeRow(tree, 'a');
  await act(async () => { row.props.onGrant('a'); row.props.onMove('a', 100); });
  let release!: Promise<void>;
  await act(async () => { release = row.props.onRelease(); void row.props.onRelease(); });
  expect(reorder).toHaveBeenCalledTimes(1);
  expect(onPreview.mock.calls.at(-1)![0].props.testID).toBe('route-drag-preview');
  expect(routeRows(tree)).toEqual(['A', 'B']);
  await act(async () => { mockSettleCallbacks.splice(0).forEach(done => done()); await release; });
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect(routeRow(tree, 'a').props.active).toBe(false);
  await act(async () => { tree.unmount(); });
});

it('rolls back a still-owned rejected drop after foreground loss ends its visual drag', async () => {
  let finish!: (accepted: boolean) => void;
  const reorder = jest.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const initial = routeStops();
  const props = { destinations: initial, canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty', onReorder: reorder };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, props)); });
  const row = routeRow(tree, 'a');
  await act(async () => { row.props.onGrant('a'); row.props.onMove('a', 100); });
  let release!: Promise<void>;
  await act(async () => { release = row.props.onRelease(); });
  expect(routeRows(tree)).toEqual(['B', 'A']);
  mockForeground = false;
  await act(async () => { tree.update(React.createElement(DestinationReorderList, { ...props, destinations: [...initial] })); });
  expect(routeRow(tree, 'a').props.active).toBe(false);
  await act(async () => { finish(false); await release; });
  expect(reorder).toHaveBeenCalledTimes(1);
  expect(routeRows(tree)).toEqual(['A', 'B']);
  mockForeground = true;
  await act(async () => { tree.update(React.createElement(DestinationReorderList,
    { ...props, destinations: initial.map(stop => ({ ...stop, order: 1 - stop.order })) })); });
  expect(routeRows(tree)).toEqual(['B', 'A']);
  await act(async () => { tree.unmount(); });
});

it('cancels an outside release and ignores a late native measurement after cancellation', async () => {
  const onPreview = jest.fn(), reorder = jest.fn();
  const pendingMeasurements: Function[] = [];
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, {
    destinations: routeStops(), canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty',
    onDragPreviewChange: onPreview, onReorder: reorder,
  }), { createNodeMock: element => ({ measureInWindow: (callback: Function) => {
    if (typeof element.props === 'object' && element.props !== null && 'testID' in element.props && element.props.testID === 'route-reorder-list') callback(20, 100, 350, 600);
    else pendingMeasurements.push(callback);
  } }) }); });
  const row = routeRow(tree, 'a');
  await act(async () => { row.props.onGrant('a', { x: 350, y: 220 }); row.props.onMove('a', 100, 320, 100, 450); });
  await act(async () => { await row.props.onRelease(); });
  expect(reorder).not.toHaveBeenCalled();
  expect(onPreview).toHaveBeenLastCalledWith(null);
  await act(async () => { pendingMeasurements.forEach(callback => callback(20, 200, 350, 52)); });
  expect(onPreview).toHaveBeenLastCalledWith(null);
  await act(async () => { tree.unmount(); });
});

it('uses the actual accessible handles for keyboard pickup, legal movement, Escape and drop', async () => {
  const rn = require('react-native');
  rn.Platform.OS = 'web';
  const documentMock = { addEventListener: jest.fn(), removeEventListener: jest.fn() };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock });
  const reorder = jest.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, {
    destinations: routeStops(), canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty', onReorder: reorder,
  })); });
  const handle = () => tree.root.findByProps({ testID: 'route-drag-handle-a' });
  const key = (value: string) => handle().props.onKeyDown({ nativeEvent: { key: value }, preventDefault: jest.fn() });
  expect(handle().type).toBe('View');
  expect(handle().props.focusable).toBe(true);
  expect(handle().props.accessibilityRole).toBe('adjustable');
  await act(async () => { key('Enter'); key('ArrowDown'); key('Escape'); });
  expect(reorder).not.toHaveBeenCalled();
  expect(routeRows(tree)).toEqual(['A', 'B']);
  await act(async () => { key(' '); key('ArrowDown'); key('Enter'); });
  expect(reorder).toHaveBeenCalledTimes(1);
  expect(reorder.mock.calls[0][0].map((entry: { id: string }) => entry.id)).toEqual(['b', 'a']);
  await act(async () => { tree.unmount(); });
  expect(documentMock.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  rn.Platform.OS = 'ios';
  Object.defineProperty(globalThis, 'document', { configurable: true, value: undefined });
});

it.each([false, true])('hides the insertion line at both original-slot boundaries with reduced motion %s', async reducedMotion => {
  mockReducedMotion = reducedMotion;
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, {
    destinations: routeStops(), canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty',
  })); });
  await act(async () => { routeRow(tree, 'a').props.onGrant('a'); });
  const scale = flatten(tree.root.findByProps({ testID: 'route-insertion-line' }).props.style).transform[1].scaleX;
  expect(scale.value).toBe(0);
  await act(async () => { routeRow(tree, 'a').props.onMove('a', 100); });
  expect(scale.value).toBe(1);
  await act(async () => { routeRow(tree, 'a').props.onMove('a', 20); });
  expect(scale.value).toBe(0);
  await act(async () => { routeRow(tree, 'a').props.onMove('a', 100); });
  expect(scale.value).toBe(1);
  await act(async () => { routeRow(tree, 'a').props.onMove('a', -1); });
  expect(scale.value).toBe(0);
  await act(async () => { routeRow(tree, 'a').props.onCancel(); tree.unmount(); });
});

it('keeps reduced-motion dragging to a static source and one insertion line', async () => {
  mockReducedMotion = true;
  const onPreview = jest.fn(), reorder = jest.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, {
    destinations: routeStops(), canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty',
    onDragPreviewChange: onPreview, onReorder: reorder,
  })); });
  await act(async () => { routeRow(tree, 'a').props.onGrant('a'); routeRow(tree, 'a').props.onMove('a', 100); });
  expect(routeRow(tree, 'a').props.active).toBe(false);
  expect(routeRow(tree, 'b').props.projection.value).toBe(0);
  expect(tree.root.findAllByProps({ testID: 'route-insertion-line' })).toHaveLength(1);
  expect(flatten(tree.root.findByProps({ testID: 'route-insertion-line' }).props.style).transform[0].translateY.value).toBe(208);
  expect(onPreview).not.toHaveBeenCalled();
  expect(mockMotionConfigs).toEqual([]);
  await act(async () => { routeRow(tree, 'a').props.onCancel(); tree.unmount(); });
  expect(reorder).not.toHaveBeenCalled();
});

it('closes the source slot without reordering and ripples visible neighbors away from both sides of the line', async () => {
  const destinations = ['a', 'b', 'c', 'd', 'e'].map((id, order) => ({ ...routeStops()[0], id, title: id.toUpperCase(), order }));
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, {
    destinations, canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty',
  })); });
  await act(async () => { routeRow(tree, 'c').props.onGrant('c'); });
  expect(routeRow(tree, 'd').props.projection.value).toBe(-52);
  expect(routeRow(tree, 'b').props.projection.value).toBe(0);
  expect(routeRows(tree)).toEqual(['A', 'B', 'C', 'D', 'E']);
  mockMotionConfigs.length = 0;
  await act(async () => { routeRow(tree, 'c').props.onMove('c', -80); });
  const pulse = mockMotionConfigs.filter(config => config.kind === 'timing' && config.duration === 65).map(config => config.toValue);
  expect(pulse).toEqual([expect.closeTo(-8), expect.closeTo(-5.6), expect.closeTo(8), expect.closeTo(5.6), expect.closeTo(3.92), expect.closeTo(2.744)]);
  expect(mockMotionConfigs.filter(config => config.kind === 'delay').map(config => config.delay)).toEqual([0, 24, 0, 24, 48, 72]);
  const motionCount = mockMotionConfigs.length;
  await act(async () => { routeRow(tree, 'c').props.onMove('c', -80); });
  expect(mockMotionConfigs.slice(motionCount).filter(config => config.duration === 65)).toHaveLength(0);
  await act(async () => { routeRow(tree, 'c').props.onCancel(); });
  expect(routeRow(tree, 'd').props.projection.value).toBe(0);
  await act(async () => { tree.unmount(); });
});

it('stops delayed pulse sequences on target interruption and visual cancellation', async () => {
  jest.useFakeTimers();
  mockDelayPulses = true;
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, {
    destinations: routeStops(), canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty',
  })); });
  await act(async () => { routeRow(tree, 'a').props.onGrant('a'); routeRow(tree, 'a').props.onMove('a', 100); });
  expect(jest.getTimerCount()).toBeGreaterThan(0);
  await act(async () => { routeRow(tree, 'a').props.onMove('a', -100); });
  await act(async () => { routeRow(tree, 'a').props.onCancel(); jest.runAllTimers(); });
  expect(mockExecutedPulses).toEqual([]);
  expect(routeRow(tree, 'b').props.projection.value).toBe(0);
  await act(async () => { tree.unmount(); });
  jest.useRealTimers();
});

it('springs projected neighbors into committed layout and retains a cancelling clone until its spring finishes', async () => {
  const onPreview = jest.fn(), reorder = jest.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, {
    destinations: [...routeStops(), { ...routeStops()[1], id: 'c', title: 'C', order: 2 }], canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty',
    onDragPreviewChange: onPreview, onReorder: reorder,
  }), { createNodeMock: () => ({ measureInWindow: (callback: Function) => callback(20, 100, 350, 600) }) }); });
  await act(async () => { routeRow(tree, 'a').props.onGrant('a'); routeRow(tree, 'a').props.onMove('a', 30); });
  mockMotionConfigs.length = 0;
  let release!: Promise<void>;
  await act(async () => { release = routeRow(tree, 'a').props.onRelease(); });
  await act(async () => { await release; });
  expect(mockMotionConfigs.some(config => config.kind === 'spring' && config.fromValue === -52 && config.toValue === 0)).toBe(true);
  expect(reorder).toHaveBeenCalledTimes(1);
  mockHoldSettle = true;
  await act(async () => { routeRow(tree, 'a').props.onGrant('a'); routeRow(tree, 'a').props.onMove('a', -100); });
  await act(async () => { routeRow(tree, 'a').props.onCancel(); });
  expect(onPreview.mock.calls.at(-1)![0].props.testID).toBe('route-drag-preview');
  expect(reorder).toHaveBeenCalledTimes(1);
  await act(async () => { mockSettleCallbacks.splice(0).forEach(done => done()); });
  expect(onPreview).toHaveBeenLastCalledWith(null);
  await act(async () => { tree.unmount(); });
});

it('uses final native release coordinates and actual unchanged list bounds at a clamped scroll edge', async () => {
  global.requestAnimationFrame = jest.fn(callback => { callback(0); return 1; });
  global.cancelAnimationFrame = jest.fn();
  const reorder = jest.fn(), autoScroll = jest.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(DestinationReorderList, {
    destinations: routeStops(), canReorder: true, tripDays: 1, colors: themes.night, emptyLabel: 'empty',
    onReorder: reorder, onDragAutoScroll: autoScroll,
  }), { createNodeMock: () => ({ measureInWindow: (callback: Function) => callback(20, 100, 350, 700) }) }); });
  const handle = () => tree.root.findByProps({ testID: 'route-drag-handle-a' });
  await act(async () => { handle().props.onPanResponderGrant({ nativeEvent: { pageX: 350, pageY: 220 } }); });
  await act(async () => { handle().props.onPanResponderMove({}, { dy: 100, moveY: 790, dx: 0, moveX: 350 }); });
  await act(async () => { await handle().props.onPanResponderRelease({ nativeEvent: { pageX: 450, pageY: 790 } }); });
  expect(reorder).not.toHaveBeenCalled();
  await act(async () => { handle().props.onPanResponderGrant({ nativeEvent: { pageX: 350, pageY: 220 } }); });
  await act(async () => { handle().props.onPanResponderMove({}, { dy: 100, moveY: 790, dx: 0, moveX: 350 }); });
  await act(async () => { await handle().props.onPanResponderRelease({ nativeEvent: { pageX: 350, pageY: 790 } }); });
  expect(autoScroll).toHaveBeenCalledWith(expect.any(Number));
  expect(reorder).toHaveBeenCalledTimes(1);
  expect(reorder.mock.calls[0][0].map((entry: { id: string }) => entry.id)).toEqual(['b', 'a']);
  await act(async () => { tree.unmount(); });
});
