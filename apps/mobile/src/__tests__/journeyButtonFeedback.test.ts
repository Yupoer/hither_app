import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { D6HomeChrome } from '../screens/MapScreen/components/D6HomeChrome';

const mockSpring = jest.fn();
const mockTiming = jest.fn();
const mockImpact = jest.fn(async () => undefined);
const mockReactions = new Set<() => void>();
const mockCancelled = { value: false, get() { return this.value; }, set(value: boolean) { this.value = value; } };
jest.mock('react-native', () => {
  class Value {
    constructor(public value: number) {}
    setValue(value: number) { this.value = value; }
    stopAnimation() {}
    __getValue() { return this.value; }
    interpolate({ inputRange, outputRange }: { inputRange: number[]; outputRange: number[] }) {
      return { __getValue: () => outputRange[0] + this.value / inputRange[1] * (outputRange[1] - outputRange[0]) };
    }
  }
  const animation = (value: Value, config: { toValue: number }) => ({ start: () => value.setValue(config.toValue) });
  return {
    View: 'View', Text: 'Text', Pressable: 'Pressable',
    AccessibilityInfo: { isScreenReaderEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
    Animated: {
      Value, View: 'AnimatedView',
      timing: (value: Value, config: { toValue: number }) => { mockTiming(config); return animation(value, config); },
      spring: (value: Value, config: { toValue: number }) => { mockSpring(config); return animation(value, config); },
      sequence: () => ({ start() {} }),
    },
    StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles },
    useWindowDimensions: () => ({ height: 900, width: 390, fontScale: 1 }),
  };
});
jest.mock('react-native-reanimated', () => {
  const { useRef, useState } = jest.requireActual<typeof import('react')>('react');
  const { useMountEffect } = jest.requireActual<typeof import('../hooks/useMountEffect')>('../hooks/useMountEffect');
  const transition = { duration: () => transition, easing: () => transition };
  return {
    __esModule: true, default: { View: 'ReanimatedView' },
    Easing: { inOut: (value: unknown) => value, cubic: () => undefined },
    FadeIn: transition, FadeOut: transition, LinearTransition: transition,
    runOnJS: (callback: () => void) => callback,
    useSharedValue: (value: unknown) => useState(() => ({ value }))[0],
    useAnimatedReaction: (prepare: () => boolean, reaction: (current: boolean, previous: boolean | null) => void) => {
      const callbacks = useRef({ prepare, reaction });
      callbacks.current = { prepare, reaction };
      useMountEffect(() => {
        const run = () => callbacks.current.reaction(callbacks.current.prepare(), null);
        mockReactions.add(run);
        return () => { mockReactions.delete(run); };
      });
    },
  };
});
jest.mock('expo-haptics', () => ({
  impactAsync: () => mockImpact(), notificationAsync: async () => undefined,
  ImpactFeedbackStyle: { Medium: 'medium', Rigid: 'rigid' }, NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-font', () => ({ useFonts: () => [true] }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('react-native-gesture-handler', () => ({ GestureDetector: 'GestureDetector' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 54, bottom: 34 }) }));
jest.mock('../../targets/live-activity/BarlowCondensed-ExtraBoldItalic.ttf', () => 1);
jest.mock('../components/AppText', () => ({ AppText: 'Text' }));
jest.mock('../components/HitherText', () => ({ HitherText: 'Text' }));
jest.mock('../components/SwiftUIGlassSurface', () => 'Glass');
jest.mock('../components/GatheringCardParticles', () => 'Particles');
jest.mock('../components/OverflowMarquee', () => 'Marquee');
jest.mock('../components/MapRecenterControl', () => 'RecenterControl');
jest.mock('../state/foregroundUi', () => ({ useForegroundUi: () => true, useVisibleUi: () => true }));
jest.mock('../native', () => ({ liquidGlass: { isLiquidGlassAvailable: () => false } }));
jest.mock('../native/d6Pane', () => ({ NativeD6GradientView: null }));
jest.mock('../screens/MapScreen/components/useD6PaneDrag', () => ({
  useD6PaneDrag: () => ({ pressCancelled: mockCancelled, detent: 'closed', preview: false }),
}));
jest.mock('../screens/MapScreen/components/D6PaneFrame', () => ({
  D6PaneFrame: ({ footer }: { footer: React.ReactNode }) => React.createElement(React.Fragment, null, footer),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const touch = { nativeEvent: { changedTouches: [{}] } };
const props: React.ComponentProps<typeof D6HomeChrome> = {
  phase: 'ready', canLead: true, asked: false, busy: false, progress: null, reduceMotion: false,
  zh: true, hasItinerary: true, stop: null, travelMode: 'walk', distance: null, eta: null,
  arrived: 0, total: 1, marqueeEnabled: false, marqueeSpeed: 20, pane: null,
  itinerary: null, team: null, selfEmoji: '🙂', selfColor: '#123456', statusColor: '#ffffff',
  hideIsland: false, hideHeader: true, onPaneChange: jest.fn(), onAction: jest.fn(),
  onStop: jest.fn(async () => true), onProfile: jest.fn(), onCommands: jest.fn(), onAdd: jest.fn(),
  onFit: jest.fn(), onLocate: jest.fn(), onTopHeight: jest.fn(),
};
async function render(overrides: Partial<typeof props> = {}) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(D6HomeChrome, { ...props, ...overrides })); });
  const button = () => tree.root.find(node => String(node.type) === 'Pressable' && node.props.testID === 'home-journey-action');
  const face = () => button().find(node => String(node.type) === 'AnimatedView');
  const shadow = () => Object.assign({}, ...button().props.style.filter(Boolean)).boxShadow;
  const depth = () => {
    const style = Object.assign({}, ...face().props.style.filter(Boolean));
    return style.transform[0].translateY.__getValue();
  };
  return { tree, button, shadow, depth };
}
beforeEach(() => { jest.clearAllMocks(); mockCancelled.set(false); });

it.each(['ready', 'empty'] as const)('renders the %s press shadow and release spring through the home action', async phase => {
  const { tree, button, shadow, depth } = await render({ phase });
  expect(shadow()).toEqual(phase === 'ready'
    ? [{ offsetX: 0, offsetY: 4, blurRadius: 0, color: '#354FC5' }] : undefined);
  expect(depth()).toBe(0);
  await act(async () => { button().props.onPressIn(); });
  expect(Boolean(shadow())).toBe(phase === 'empty');
  expect(depth()).toBe(phase === 'empty' ? -4 : 4);
  expect(props.onAction).not.toHaveBeenCalled();
  await act(async () => { button().props.onPressOut(); });
  expect(Boolean(shadow())).toBe(phase === 'ready');
  expect(depth()).toBe(0);
  expect(mockSpring).toHaveBeenCalledWith(expect.objectContaining({
    toValue: 0, stiffness: 340, damping: 18, mass: 0.8, useNativeDriver: true,
  }));
  expect(props.onAction).not.toHaveBeenCalled();
  await act(async () => { button().props.onPress(touch); });
  expect(props.onAction).toHaveBeenCalledTimes(1);
  await act(async () => { tree.unmount(); });
});
it('cancels a dragged press and rejects its stale release after the gesture resets', async () => {
  const { tree, button, depth } = await render();
  expect(mockReactions.size).toBe(1);
  await act(async () => { button().props.onPressIn(); });
  expect(mockReactions.size).toBe(1);
  await act(async () => { mockCancelled.set(true); for (const reaction of mockReactions) reaction(); });
  expect(depth()).toBe(0);
  mockCancelled.set(false);
  await act(async () => { button().props.onPressOut(); button().props.onPress(touch); });
  expect(props.onAction).not.toHaveBeenCalled();
  await act(async () => { button().props.onPressIn(); button().props.onPressOut(); button().props.onPress(touch); });
  expect(props.onAction).toHaveBeenCalledTimes(1);
  await act(async () => { tree.unmount(); });
  expect(mockReactions.size).toBe(0);
});
it.each(['ready', 'empty'] as const)('keeps %s shadow feedback with reduced motion and skips face motion', async phase => {
  const { tree, button, shadow, depth } = await render({ phase, reduceMotion: true });
  await act(async () => { button().props.onPressIn(); });
  expect(Boolean(shadow())).toBe(phase === 'empty');
  expect(depth()).toBe(0);
  await act(async () => { button().props.onPressOut(); });
  expect(Boolean(shadow())).toBe(phase === 'ready');
  expect(depth()).toBe(0);
  expect(mockSpring).not.toHaveBeenCalled();
  expect(mockTiming).not.toHaveBeenCalled();
  await act(async () => { tree.unmount(); });
});
it('keeps unavailable actions disabled and gives them no depth feedback', async () => {
  const { tree, button, shadow, depth } = await render({ busy: true });
  expect(button().props.disabled).toBe(true);
  await act(async () => { button().props.onPressIn(); });
  expect(shadow()).toBeUndefined();
  expect(depth()).toBe(0);
  expect(mockImpact).not.toHaveBeenCalled();
  await act(async () => { tree.unmount(); });
});
it('keeps the navigation hold and prevents a short release from running the action', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  const { tree, button } = await render({ phase: 'going' });
  await act(async () => { button().props.onPressIn(); button().props.onPressOut(); button().props.onPress(touch); });
  expect(props.onAction).not.toHaveBeenCalled();
  expect(props.onStop).not.toHaveBeenCalled();
  await act(async () => { button().props.onPressIn(); button().props.onLongPress(); });
  expect(props.onStop).toHaveBeenCalledTimes(1);
  await act(async () => { button().props.onPressOut(); button().props.onPress(touch); tree.unmount(); });
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
