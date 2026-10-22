import React from 'react';

let mockVisuals = true;
let mockNow = 0;
const mockClockListeners = new Set<() => void>();
const mockSubscribeClock = (listener: () => void) => {
  mockClockListeners.add(listener);
  return () => mockClockListeners.delete(listener);
};
const mockValues: { value: number }[] = [];
const mockCancel = jest.fn();
const mockTiming = jest.fn((value: number, _config: unknown) => value);
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text',
  StyleSheet: { create: (value: unknown) => value,
    flatten: (value: unknown) => Array.isArray(value) ? Object.assign({}, ...value) : value },
}));
jest.mock('../state/foregroundUi', () => ({
  useOptionalVisuals: () => mockVisuals,
  // Supports the foundation clock and identity owner's pending lifecycle API.
  useForegroundClock: () => {
    const now = require('react').useSyncExternalStore(mockSubscribeClock, () => mockNow, () => mockNow);
    return { now, lifecycle: null, valueOf: () => now };
  },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView' },
  cancelAnimation: (value: unknown) => mockCancel(value),
  withTiming: (value: number, config: unknown) => mockTiming(value, config),
  withRepeat: (value: number) => value, withDelay: (_: number, value: number) => value,
  withSequence: (...values: number[]) => values[values.length - 1],
  useReducedMotion: () => false, Easing: { linear: 'linear' }, ReduceMotion: { System: 'system' },
  useAnimatedStyle: () => ({}),
  useSharedValue: (value: number) => {
    const ref = require('react').useRef(null);
    if (!ref.current) { ref.current = { value }; mockValues.push(ref.current); }
    return ref.current;
  },
}));
import OverflowMarquee from '../components/OverflowMarquee';
import MeetCountdown from '../components/MeetCountdown';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  mockVisuals = true; mockNow = 0; mockValues.length = 0; mockClockListeners.clear(); jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());
const measure = (root: any) => root.root.findAllByType('Text').find((node: any) => node.props.onTextLayout);
const viewport = (root: any) => root.root.findAllByType('View').find((node: any) => node.props.onLayout);

it('preserves marquee measurement on equal fonts, updates speed, and retries a font reset only once', async () => {
  let root: any;
  const props = { text: 'Long title', activationDelayMs: 100, style: { fontSize: 16 } };
  await act(async () => { root = create(React.createElement(OverflowMarquee, props)); });
  const host = viewport(root);
  const text = measure(root);
  const offset = mockValues[0];
  await act(async () => {
    host.props.onLayout({ nativeEvent: { layout: { width: 100 } } });
    text.props.onTextLayout({ nativeEvent: { lines: [{ width: 200 }] } });
    jest.advanceTimersByTime(99);
  });
  expect(root.root.findAllByType('AnimatedView')).toHaveLength(0);
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(mockTiming).toHaveBeenCalledWith(-100, expect.objectContaining({ duration: 2500 }));
  const count = mockTiming.mock.calls.length;
  await act(async () => { root.update(React.createElement(OverflowMarquee, { ...props, style: { fontSize: 16, color: 'red' } })); });
  expect(measure(root)).toBe(text);
  expect(mockTiming).toHaveBeenCalledTimes(count);
  await act(async () => { root.update(React.createElement(OverflowMarquee, { ...props, pixelsPerSecond: 80 })); });
  expect(mockTiming).toHaveBeenCalledWith(-100, expect.objectContaining({ duration: 1250 }));
  expect(viewport(root)).toBe(host);
  await act(async () => { root.update(React.createElement(OverflowMarquee, { ...props, style: { fontSize: 18 }, pixelsPerSecond: 80 })); });
  const newFontText = measure(root);
  expect(newFontText).not.toBe(text);
  expect(root.root.findAllByType('AnimatedView')).toHaveLength(0);
  await act(async () => { jest.advanceTimersByTime(50); });
  const retried = measure(root);
  expect(retried).not.toBe(newFontText);
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(measure(root)).toBe(retried);
  await act(async () => { retried.props.onLayout({ nativeEvent: { layout: { width: 220 } } }); });
  expect(mockTiming).toHaveBeenCalledWith(-120, expect.objectContaining({ duration: 1500 }));
  expect(mockValues).toHaveLength(1);
  await act(async () => { root.unmount(); });
  expect(jest.getTimerCount()).toBe(0);
  expect(mockCancel).toHaveBeenLastCalledWith(offset);
});

it('cancels old activation and retry timers on text, activity and visual policy changes', async () => {
  let root: any;
  const props = { text: 'A', activationDelayMs: 100 };
  await act(async () => { root = create(React.createElement(OverflowMarquee, props)); });
  const host = viewport(root);
  await act(async () => { host.props.onLayout({ nativeEvent: { layout: { width: 100 } } }); });
  expect(jest.getTimerCount()).toBe(2);
  await act(async () => { root.update(React.createElement(OverflowMarquee, { ...props, text: 'B', active: false })); });
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(root.root.findAllByType('AnimatedView')).toHaveLength(0);
  mockVisuals = false;
  await act(async () => { root.update(React.createElement(OverflowMarquee, { ...props, text: 'B' })); });
  expect(jest.getTimerCount()).toBe(0);
  expect(viewport(root)).toBe(host);
  mockVisuals = true;
  await act(async () => { root.update(React.createElement(OverflowMarquee, { ...props, text: 'B' })); });
  await act(async () => { measure(root).props.onLayout({ nativeEvent: { layout: { width: 200 } } }); });
  await act(async () => { jest.advanceTimersByTime(99); });
  expect(root.root.findAllByType('AnimatedView')).toHaveLength(0);
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(root.root.findAllByType('AnimatedView')).toHaveLength(1);
  await act(async () => { root.unmount(); });
  expect(jest.getTimerCount()).toBe(0);
});

it('notifies due changes and callback reference changes while retaining the text owner', async () => {
  let root: any;
  const first = jest.fn(), second = jest.fn();
  const props = { meetAtIso: '1970-01-01T00:01:00Z', redWithinMin: 1, redColor: 'red', onDueChange: first };
  await act(async () => { root = create(React.createElement(MeetCountdown, props)); });
  const text = root.root.findByType('Text');
  expect(first).toHaveBeenCalledWith(false);
  await act(async () => { root.update(React.createElement(MeetCountdown, { ...props, baseStyle: { color: 'white' } })); });
  expect(first).toHaveBeenCalledTimes(1);
  await act(async () => { root.update(React.createElement(MeetCountdown, { ...props, onDueChange: second })); });
  expect(second).toHaveBeenCalledWith(false);
  await act(async () => { mockNow = 61000; mockClockListeners.forEach(listener => listener()); });
  expect(second.mock.calls).toEqual([[false], [true]]);
  await act(async () => { root.update(React.createElement(MeetCountdown, props)); });
  expect(first.mock.calls).toEqual([[false], [true]]);
  expect(root.root.findByType('Text')).toBe(text);
  await act(async () => { root.unmount(); });
  expect(mockClockListeners.size).toBe(0);
});

it('does not publish a due callback from a suspended render that is discarded', async () => {
  let root: any;
  let suspended = false;
  const never = new Promise<void>(() => {});
  function Suspend() { if (suspended) throw never; return null; }
  const first = jest.fn(), second = jest.fn();
  const element = (onDueChange: (due: boolean) => void) => React.createElement(React.Suspense, { fallback: 'loading' },
    React.createElement(MeetCountdown, { meetAtIso: '1970-01-01T00:01:00Z', redWithinMin: 1, redColor: 'red', onDueChange }),
    React.createElement(Suspend));
  await act(async () => { root = create(element(first)); });
  expect(first).toHaveBeenCalledTimes(1);
  suspended = true;
  await act(async () => { root.update(element(second)); });
  expect(second).not.toHaveBeenCalled();
  suspended = false;
  await act(async () => { root.update(element(first)); });
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  await act(async () => { root.unmount(); });
  expect(mockClockListeners.size).toBe(0);
});
