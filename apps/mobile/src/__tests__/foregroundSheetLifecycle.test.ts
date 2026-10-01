import React from 'react';
const mockListeners = new Set<(state: string) => void>();
const mockAppState = { currentState: 'active', addEventListener: (_: string, listener: (state: string) => void) => {
  mockListeners.add(listener); return { remove: () => mockListeners.delete(listener) };
} };
const mockTimings: any[] = [];
const mockSprings: any[] = [];
const mockNativeTimings: any[] = [];
const mockGestures: any[] = [];
function mockValue(initial: any): any {
  let value = initial;
  let animation: any;
  return { get value() { return value; }, set value(next: any) {
    if (animation && !animation.completed) { animation.cancelled = true; animation.callback?.(false); }
    animation = typeof next === 'object' && next?.animation ? next : undefined;
    value = animation ? animation.target : next;
  }, cancel() { if (animation && !animation.completed) { animation.cancelled = true; animation.callback?.(false); } } };
}
jest.mock('react-native', () => ({ AppState: mockAppState, Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ width: 390, height: 844 }), Text: 'Text', Pressable: 'Pressable',
  PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) },
  Animated: {
    Value: class { pending: any; constructor(public value: number) {} setValue(value: number) { this.stopAnimation(); this.value = value; }
      stopAnimation() { this.pending?.callback({ finished: false }); } interpolate() { return 0; } },
    View: 'NativeAnimatedView', add: () => 0, multiply: () => 0,
    timing: (value: any, config: any) => ({ start: (callback?: (result: any) => void) => {
      value.stopAnimation();
      const entry = { config, callback: (result: any) => {
        if (value.pending === entry) value.pending = undefined;
        callback?.(result);
      } }; value.pending = entry; mockNativeTimings.push(entry);
    } }),
    spring: () => ({ start: () => {} }),
  },
  View: 'View', ScrollView: 'ScrollView', StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
}));
jest.mock('react-native-gesture-handler', () => ({ GestureDetector: 'GestureDetector', ScrollView: 'ScrollView',
  Gesture: { Pan: () => {
    const handlers: any = {};
    const chain: any = new Proxy(handlers, { get: (_, name) => (value: unknown) => { handlers[name] = value; return chain; } });
    mockGestures.push(handlers); return chain;
  } },
}));
jest.mock('react-native-reanimated', () => ({ __esModule: true,
  default: { View: 'AnimatedView', createAnimatedComponent: () => 'AnimatedScrollView' },
  useAnimatedRef: () => require('react').useRef(null),
  useSharedValue: (initial: unknown) => require('react').useRef(mockValue(initial)).current,
  useAnimatedReaction: () => {}, useAnimatedScrollHandler: () => () => {},
  useAnimatedStyle: (factory: () => unknown) => factory(),
  cancelAnimation: (value: any) => value.cancel(),
  useReducedMotion: () => false,
  Easing: { linear: (value: unknown) => value }, withRepeat: (value: unknown) => value,
  withSpring: (target: number, _: unknown, callback?: unknown) => {
    const animation: any = { target, cancelled: false, completed: false, animation: true };
    animation.callback = (finished: boolean) => { animation.completed = true; (callback as any)?.(finished); };
    (callback ? mockTimings : mockSprings).push(animation); return animation;
  },
  withTiming: (target: number, _: unknown, callback: unknown) => {
    const animation: any = { target, cancelled: false, completed: false, animation: true };
    animation.callback = (finished: boolean) => { animation.completed = true; (callback as any)?.(finished); };
    mockTimings.push(animation); return animation;
  },
  runOnJS: (callback: unknown) => callback, scrollTo: () => {},
  interpolate: (value: number) => value, Extrapolation: { CLAMP: 'clamp' },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../native', () => ({ liquidGlass: { GlassView: 'GlassView', isLiquidGlassAvailable: () => true } }));
jest.mock('../components/SwiftUIGlassSurface', () => 'GlassSurface');
jest.mock('../components/SheetHeaderAction', () => 'HeaderAction');
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-glass-effect', () => ({ GlassView: 'NativeGlass', isLiquidGlassAvailable: () => true }));
jest.mock('expo-blur', () => ({ BlurView: 'NativeBlur' }));
jest.mock('@expo/ui/swift-ui', () => ({ Host: 'SwiftUIHost', Spacer: 'Spacer', VStack: 'VStack' }));
jest.mock('@expo/ui/swift-ui/modifiers', () => ({ frame: (value: unknown) => value, glassEffect: (value: unknown) => value }));
jest.mock('../state/PreferencesContext', () => ({ useTheme: () => ({ colors: { glass: 'rgba(1,2,3,0.9)' } }) }));
import BottomSheet from '../components/BottomSheet';
import { GlassView } from '../native/liquidGlass';
import SwiftUIGlassSurface from '../components/SwiftUIGlassSurface.ios';
import OverlaySheet from '../components/OverlaySheet';
import { AmicroButton } from '../components/AmicroButton';
import { updateRuntimePowerState } from '../state/runtimePowerState';
import { usePendingPlaceEntrance } from '../screens/MapScreen/hooks/usePendingPlaceEntrance';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
function transition(state: string) {
  mockAppState.currentState = state;
  for (const listener of mockListeners) listener(state);
}
beforeEach(() => {
  mockAppState.currentState = 'active';
  mockGestures.length = 0; mockTimings.length = 0; mockNativeTimings.length = 0; mockSprings.length = 0;
  updateRuntimePowerState({ thermalState: 'nominal', lowPowerMode: false });
});

it('cancels mid-dismiss on lock, retains child drafts, and completes the current close once after resume', async () => {
  const height = mockValue(300), dismissY = mockValue(0);
  const completed = jest.fn(), mounted = jest.fn();
  function Draft() {
    const [text, setText] = React.useState('');
    React.useEffect(() => { mounted(); }, []);
    return React.createElement('draft', { text, setText });
  }
  const sheet = (close: boolean, index = 0) => React.createElement(BottomSheet, {
    height, dismissTranslateY: dismissY, dismissRequested: !close,
    dismissDistance: 800, detents: [300, 600], index, bottomInset: 0,
    onIndexChange: jest.fn(), onDismissComplete: completed,
    children: React.createElement(Draft),
  });
  let root: any;
  await act(async () => { root = create(sheet(false)); });
  await act(async () => { root.root.findByType('draft').props.setText('unsaved'); root.update(sheet(true)); });
  const original = mockTimings.at(-1);
  expect(original.cancelled).toBe(false);
  await act(async () => { transition('inactive'); transition('background'); });
  expect(original.cancelled).toBe(true);
  expect(completed).not.toHaveBeenCalled();
  expect(root.root.findByType('draft').props.text).toBe('unsaved');
  await act(async () => { transition('active'); transition('active'); });
  const resumed = mockTimings.at(-1);
  expect(resumed).not.toBe(original);
  expect(resumed.cancelled).toBe(false);
  // A detent/index update must not cancel the independent close animation.
  await act(async () => { root.update(sheet(true, 1)); });
  expect(resumed.cancelled).toBe(false);
  await act(async () => { resumed.callback(true); });
  expect(completed).toHaveBeenCalledTimes(1);
  expect(mounted).toHaveBeenCalledTimes(1);
  await act(async () => { root.unmount(); });
  expect(mockListeners.size).toBe(0);
});

it('releases native glass underlays while preserving both sibling form drafts across background', async () => {
  const mounted = jest.fn();
  function Draft() {
    const [text, setText] = React.useState('');
    React.useEffect(() => { mounted(); }, []);
    return React.createElement('draft', { text, setText });
  }
  let root: any;
  await act(async () => { root = create(React.createElement(React.Fragment, null,
    React.createElement(GlassView, { tintColor: '#ffffff' }, React.createElement(Draft)),
    React.createElement(SwiftUIGlassSurface, {}, React.createElement(Draft)))); });
  await act(async () => { for (const draft of root.root.findAllByType('draft')) draft.props.setText('unsaved'); });
  expect(root.root.findAllByType('NativeGlass')).toHaveLength(1);
  expect(root.root.findAllByType('SwiftUIHost')).toHaveLength(1);
  await act(async () => { transition('background'); });
  expect(root.root.findAllByType('NativeGlass')).toHaveLength(0);
  expect(root.root.findAllByType('SwiftUIHost')).toHaveLength(0);
  await act(async () => { transition('active'); });
  expect(root.root.findAllByType('NativeGlass')).toHaveLength(1);
  expect(root.root.findAllByType('SwiftUIHost')).toHaveLength(1);
  expect(root.root.findAllByType('draft').every((draft: any) => draft.props.text === 'unsaved')).toBe(true);
  expect(mounted).toHaveBeenCalledTimes(2);
  await act(async () => { root.unmount(); });
});

it('retains an overlay draft and does not repeat its open completion or entrance on foreground resume', async () => {
  const opened = jest.fn(), mounted = jest.fn();
  function Draft() {
    const [text, setText] = React.useState('');
    React.useEffect(() => { mounted(); }, []);
    return React.createElement('draft', { text, setText });
  }
  let root: any;
  await act(async () => { root = create(React.createElement(OverlaySheet, { visible: true,
    onClose: jest.fn(), onOpenComplete: opened, title: 'edit', accent: '#ffffff', doneLabel: 'Done',
    children: React.createElement(Draft),
  })); });
  await act(async () => { mockNativeTimings.at(-1).callback({ finished: true });
    root.root.findByType('draft').props.setText('unsaved'); });
  expect(opened).toHaveBeenCalledTimes(1);
  const count = mockNativeTimings.length;
  await act(async () => { transition('background'); });
  await act(async () => { transition('active'); transition('active'); });
  expect(mockNativeTimings).toHaveLength(count);
  expect(opened).toHaveBeenCalledTimes(1);
  expect(root.root.findByType('draft').props.text).toBe('unsaved');
  expect(mounted).toHaveBeenCalledTimes(1);
  await act(async () => { root.unmount(); });
});

it('suspends a committed overlay drag close without closing or clearing its draft, then closes once', async () => {
  const closed = jest.fn();
  function Draft() {
    const [text, setText] = React.useState('unsaved');
    return React.createElement('draft', { text, setText });
  }
  let root: any;
  await act(async () => { root = create(React.createElement(OverlaySheet, { visible: true,
    onClose: closed, title: 'edit', accent: '#ffffff', children: React.createElement(Draft),
  })); });
  await act(async () => { mockNativeTimings.at(-1).callback({ finished: true }); });
  const grabber = root.root.findAllByType('View').find((node: any) => node.props.onPanResponderRelease);
  await act(async () => { grabber.props.onPanResponderRelease(null, { dy: 100, vy: 1 }); });
  const original = mockNativeTimings.at(-1);
  await act(async () => { transition('background'); });
  expect(closed).not.toHaveBeenCalled();
  expect(root.root.findByType('draft').props.text).toBe('unsaved');
  await act(async () => { transition('active'); transition('active'); });
  const resumed = mockNativeTimings.at(-1);
  expect(resumed).not.toBe(original);
  expect(resumed.config.toValue).toBe(844);
  await act(async () => { resumed.callback({ finished: true }); resumed.callback({ finished: true }); });
  expect(closed).toHaveBeenCalledTimes(1);
  await act(async () => { root.unmount(); });
});

it.each([true, false])('retains a committed bottom-sheet gesture close during lock (translate=%s)', async (translate) => {
  const height = mockValue(300), dismissY = mockValue(0);
  const closed = jest.fn(), completed = jest.fn();
  let root: any;
  await act(async () => { root = create(React.createElement(BottomSheet, { height,
    ...(translate ? { dismissTranslateY: dismissY, dismissRequested: true } : {}),
    dismissDistance: 800, detents: [300, 600], index: 0, bottomInset: 0,
    dismissOnDownFromIndex: 0, onIndexChange: jest.fn(), onDismiss: closed,
    onDismissComplete: completed, children: React.createElement('draft', { text: 'unsaved' }),
  })); });
  const gesture = mockGestures.at(-1);
  await act(async () => { gesture.onBegin(); gesture.onUpdate({ translationY: 100 });
    gesture.onEnd({ translationY: 100, velocityY: 800 }, true); });
  const original = mockTimings.at(-1);
  await act(async () => { transition('inactive'); transition('background'); });
  expect(original.cancelled).toBe(true);
  expect(closed).not.toHaveBeenCalled();
  await act(async () => { transition('active'); transition('active'); });
  const resumed = mockTimings.at(-1);
  expect(resumed).not.toBe(original);
  expect(resumed.target).toBe(translate ? 800 : 0);
  await act(async () => { resumed.callback(true); resumed.callback(true); });
  expect(closed).toHaveBeenCalledTimes(1);
  expect(completed).toHaveBeenCalledTimes(translate ? 1 : 0);
  expect(root.root.findByType('draft').props.text).toBe('unsaved');
  await act(async () => { root.unmount(); });
});

it.each([true, false])('does not commit an OS-cancelled downward gesture (background first=%s)', async (backgroundFirst) => {
  const height = mockValue(300), dismissY = mockValue(0);
  const closed = jest.fn(), completed = jest.fn();
  let root: any;
  await act(async () => { root = create(React.createElement(BottomSheet, { height,
    dismissTranslateY: dismissY, dismissRequested: true, dismissDistance: 800,
    detents: [300, 600], index: 0, bottomInset: 0, dismissOnDownFromIndex: 0,
    onIndexChange: jest.fn(), onDismiss: closed, onDismissComplete: completed,
    children: React.createElement('draft', { text: 'unsaved' }),
  })); });
  const gesture = mockGestures.at(-1);
  await act(async () => { gesture.onBegin(); gesture.onUpdate({ translationY: 100 }); });
  const count = mockTimings.length;
  await act(async () => {
    if (backgroundFirst) transition('background');
    gesture.onEnd({ translationY: 100, velocityY: 800 }, false);
    if (!backgroundFirst) transition('background');
  });
  expect(mockTimings).toHaveLength(count);
  expect(closed).not.toHaveBeenCalled();
  expect(dismissY.value).toBe(0);
  await act(async () => { transition('active'); });
  expect(mockTimings).toHaveLength(count);
  expect(closed).not.toHaveBeenCalled();
  expect(completed).not.toHaveBeenCalled();
  expect(root.root.findByType('draft').props.text).toBe('unsaved');
  await act(async () => { root.unmount(); });
});

it.each(['background', 'fair'])('finishes an accepted Amicro operation once when visuals stop for %s', async (reason) => {
  const action = jest.fn();
  let release: () => void = () => {};
  action.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
  const haptic = jest.fn();
  let root: any;
  await act(async () => { root = create(React.createElement(AmicroButton, { icon: 'share', color: '#ffffff',
    accessibilityLabel: 'share', onPress: haptic, onAnimationComplete: action,
  })); });
  const press = () => root.root.findByType('Pressable').props.onPress();
  await act(async () => { press(); });
  const pending = mockTimings.at(-1);
  expect(action).not.toHaveBeenCalled();
  await act(async () => { if (reason === 'background') transition('background');
    else updateRuntimePowerState({ thermalState: 'fair', lowPowerMode: false }); });
  expect(pending.cancelled).toBe(true);
  expect(action).toHaveBeenCalledTimes(1);
  const count = mockTimings.length;
  await act(async () => { press(); transition('active');
    updateRuntimePowerState({ thermalState: 'nominal', lowPowerMode: false }); });
  expect(action).toHaveBeenCalledTimes(1);
  expect(haptic).toHaveBeenCalledTimes(1);
  expect(mockTimings).toHaveLength(count);
  await act(async () => { pending.callback(true); release(); });
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => { root.unmount(); });
});

it('restores the same pending map place to its final pose without replaying its entrance', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  const height = mockValue(300);
  const first: any = { name: 'one', coordinates: { latitude: 1, longitude: 1 } };
  const next: any = { name: 'two', coordinates: { latitude: 2, longitude: 2 } };
  function Card({ place, visible }: any) {
    const entrance = usePendingPlaceEntrance(place, visible, height);
    return React.createElement('card', entrance);
  }
  let root: any;
  await act(async () => { root = create(React.createElement(Card, { place: first, visible: true })); });
  await act(async () => { jest.runOnlyPendingTimers(); });
  const original = mockSprings.at(-1);
  expect(root.root.findByType('card').props.ready).toBe(true);
  expect(mockSprings).toHaveLength(1);
  await act(async () => { root.update(React.createElement(Card, { place: first, visible: false })); });
  expect(original.cancelled).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => { root.update(React.createElement(Card, { place: first, visible: true })); });
  await act(async () => { jest.runOnlyPendingTimers(); });
  expect(mockSprings).toHaveLength(1);
  expect(root.root.findByType('card').props.progress.value).toBe(1);
  // A new selection earns a new entrance; changing while suspended creates no timer.
  await act(async () => { root.update(React.createElement(Card, { place: next, visible: false })); });
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => { root.update(React.createElement(Card, { place: next, visible: true })); });
  await act(async () => { jest.runOnlyPendingTimers(); });
  expect(mockSprings).toHaveLength(2);
  await act(async () => { root.update(React.createElement(Card, { place: null, visible: false })); });
  expect(root.root.findByType('card').props.ready).toBe(false);
  expect(root.root.findByType('card').props.progress.value).toBe(0);
  await act(async () => { root.unmount(); });
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
