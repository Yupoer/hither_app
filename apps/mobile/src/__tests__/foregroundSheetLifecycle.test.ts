import React from 'react';
const mockListeners = new Set<(state: string) => void>();
const mockAppState = { currentState: 'active', addEventListener: (_: string, listener: (state: string) => void) => {
  mockListeners.add(listener); return { remove: () => mockListeners.delete(listener) };
} };
const mockTimings: any[] = [];
const mockNativeTimings: any[] = [];
function mockValue(initial: any): any {
  let value = initial;
  let animation: any;
  return { get value() { return value; }, set value(next: any) {
    if (animation) animation.cancelled = true;
    animation = typeof next === 'object' && next?.animation ? next : undefined;
    value = animation ? animation.target : next;
  }, cancel() { if (animation) animation.cancelled = true; } };
}
jest.mock('react-native', () => ({ AppState: mockAppState, Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ width: 390, height: 844 }), Text: 'Text', Pressable: 'Pressable',
  PanResponder: { create: () => ({ panHandlers: {} }) },
  Animated: {
    Value: class { constructor(public value: number) {} setValue(value: number) { this.value = value; }
      stopAnimation() {} interpolate() { return 0; } },
    View: 'NativeAnimatedView', add: () => 0, multiply: () => 0,
    timing: () => ({ start: (callback: unknown) => { mockNativeTimings.push({ callback }); } }),
  },
  View: 'View', ScrollView: 'ScrollView', StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
}));
jest.mock('react-native-gesture-handler', () => ({ GestureDetector: 'GestureDetector', ScrollView: 'ScrollView',
  Gesture: { Pan: () => { const chain: any = new Proxy({}, { get: () => () => chain }); return chain; } },
}));
jest.mock('react-native-reanimated', () => ({ __esModule: true,
  default: { View: 'AnimatedView', createAnimatedComponent: () => 'AnimatedScrollView' },
  useAnimatedRef: () => require('react').useRef(null),
  useSharedValue: (initial: unknown) => require('react').useRef(mockValue(initial)).current,
  useAnimatedReaction: () => {}, useAnimatedScrollHandler: () => () => {},
  useAnimatedStyle: (factory: () => unknown) => factory(),
  cancelAnimation: (value: any) => value.cancel(),
  withSpring: (target: number) => target,
  withTiming: (target: number, _: unknown, callback: unknown) => {
    const animation = { target, callback, cancelled: false, animation: true };
    mockTimings.push(animation); return animation;
  },
  runOnJS: (callback: unknown) => callback, scrollTo: () => {},
  interpolate: (value: number) => value, Extrapolation: { CLAMP: 'clamp' },
}));
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
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
function transition(state: string) {
  mockAppState.currentState = state;
  for (const listener of mockListeners) listener(state);
}

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
