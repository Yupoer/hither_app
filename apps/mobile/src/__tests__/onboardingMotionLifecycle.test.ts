import React from 'react';

let mockVisuals = true;
let mockFontScale = 1;
let mockThemeName = 'night';
const mockReduceMotionListeners = new Set<(value: boolean) => void>();
const mockValues: { value: number }[] = [];
const mockCancel = jest.fn();
const mockTiming = jest.fn((value: number) => value);
const mockSetThemeName = jest.fn((name: string) => { mockThemeName = name; });
jest.mock('react-native', () => ({
  View: 'View', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {}, hairlineWidth: 1 },
  PixelRatio: { roundToNearestPixel: (value: number) => value }, Platform: { OS: 'ios' },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: (_: string, listener: (value: boolean) => void) => {
      mockReduceMotionListeners.add(listener);
      return { remove: () => mockReduceMotionListeners.delete(listener) };
    },
  },
}));
jest.mock('../state/foregroundUi', () => ({ useOptionalVisuals: () => mockVisuals }));
jest.mock('../state/PreferencesContext', () => ({
  useTheme: () => ({ colors: require('../theme').themes[mockThemeName], themeName: mockThemeName }),
  usePreferences: () => ({ setThemeName: mockSetThemeName }),
}));
jest.mock('../a11y/useFontScaleBucket', () => ({ useFontLayout: () => ({ scale: mockFontScale }) }));
jest.mock('../components/HitherText', () => ({ HitherText: 'Text' }));
jest.mock('../components/CrookIcon', () => 'CrookIcon');
jest.mock('../utils/haptics', () => ({ mediumTap: jest.fn(), selectionTick: jest.fn() }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (value: string) => value }) }));
jest.mock('../onboarding/icons', () => ({ OnboardingIcons: { mascot: {} } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView', createAnimatedComponent: (value: unknown) => value },
  cancelAnimation: (value: unknown) => mockCancel(value),
  withTiming: (value: number) => mockTiming(value), withSpring: (value: number) => value,
  withRepeat: (value: number) => value, withDelay: (_: number, value: number) => value,
  withSequence: (...values: number[]) => values[values.length - 1],
  Easing: { cubic: 'cubic', out: (value: unknown) => value, in: (value: unknown) => value,
    inOut: (value: unknown) => value, back: (value: unknown) => value },
  interpolateColor: () => '#fff', useAnimatedStyle: () => ({}),
  useSharedValue: (value: number) => {
    const ref = require('react').useRef(null);
    if (!ref.current) { ref.current = { value }; mockValues.push(ref.current); }
    return ref.current;
  },
}));
import StepShell from '../onboarding/steps/StepShell';
import IntroStep from '../onboarding/steps/IntroStep';
import CelebrationStep from '../onboarding/steps/CelebrationStep';
import ThemeStep from '../onboarding/steps/ThemeStep';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockVisuals = true; mockFontScale = 1; mockThemeName = 'night';
  mockValues.length = 0; mockReduceMotionListeners.clear(); jest.clearAllMocks();
});
const stepProps = () => ({ answers: {}, onAnswer: jest.fn(), onSkip: jest.fn(), onBack: jest.fn() });

it('updates progress and reduced motion while retaining the shell scroll owner and removing its listener', async () => {
  let root: any;
  const props: React.ComponentProps<typeof StepShell> = {
    step: 'theme', role: 'leader', title: 'Theme', onSkip: jest.fn(), children: 'draft',
  };
  await act(async () => { root = create(React.createElement(StepShell, props)); });
  const scroll = root.root.findByType('ScrollView');
  const progress = mockValues[0];
  const start = progress.value;
  await act(async () => { root.update(React.createElement(StepShell, { ...props, step: 'L1_purpose' })); });
  expect(progress.value).toBeGreaterThan(start);
  expect(root.root.findByType('ScrollView')).toBe(scroll);
  const count = mockTiming.mock.calls.length;
  await act(async () => { mockReduceMotionListeners.forEach(listener => listener(true)); });
  expect(mockTiming).toHaveBeenCalledTimes(count);
  expect(mockValues).toHaveLength(2);
  await act(async () => { root.unmount(); });
  expect(mockReduceMotionListeners.size).toBe(0);
  expect(mockCancel).toHaveBeenLastCalledWith(progress);
});

it('keeps the intro stage and members through type scaling and visual suspension', async () => {
  let root: any;
  const props = stepProps();
  await act(async () => { root = create(React.createElement(IntroStep, props)); });
  const scroll = root.root.findByType('ScrollView');
  const members = root.root.findAllByType('AnimatedView');
  const count = mockValues.length;
  const timingCount = mockTiming.mock.calls.length;
  mockFontScale = 2;
  await act(async () => { root.update(React.createElement(IntroStep, props)); });
  expect(mockTiming).toHaveBeenCalledTimes(timingCount);
  mockVisuals = false;
  await act(async () => { root.update(React.createElement(IntroStep, props)); });
  expect(root.root.findByType('ScrollView')).toBe(scroll);
  expect(root.root.findAllByType('AnimatedView')).toEqual(members);
  expect(mockValues).toHaveLength(count);
  expect(mockReduceMotionListeners.size).toBe(2);
  await act(async () => { root.unmount(); });
  expect(mockReduceMotionListeners.size).toBe(0);
});

it('retains celebration shared values and content through stop and resume without replaying a settled pop', async () => {
  let root: any;
  const props = stepProps();
  await act(async () => { root = create(React.createElement(CelebrationStep, props)); });
  const content = root.root.findAllByType('AnimatedView');
  const values = [...mockValues];
  const count = mockTiming.mock.calls.length;
  await act(async () => { root.update(React.createElement(CelebrationStep, props)); });
  expect(mockTiming).toHaveBeenCalledTimes(count);
  mockVisuals = false;
  await act(async () => { root.update(React.createElement(CelebrationStep, props)); });
  expect(values[0].value).toBe(1);
  mockVisuals = true;
  await act(async () => { root.update(React.createElement(CelebrationStep, props)); });
  expect(root.root.findAllByType('AnimatedView')).toEqual(content);
  expect(mockValues).toEqual(values);
  expect(mockCancel).toHaveBeenCalledWith(values[0]);
  await act(async () => { root.unmount(); });
});

it('restarts confetti for an equal-valued new spec reference and preserves its shared phase', async () => {
  let screen: any;
  await act(async () => { screen = create(React.createElement(CelebrationStep, stepProps())); });
  const confetti = screen.root.findAll((node: any) => node.type.name === 'Confetti')[0];
  const component = confetti.type;
  const spec = confetti.props.spec;
  await act(async () => { screen.unmount(); });
  jest.clearAllMocks(); mockValues.length = 0;
  let root: any;
  const element = (input: unknown) => React.createElement(component, { spec: input });
  await act(async () => { root = create(element(spec)); });
  const phase = mockValues[0];
  expect(mockTiming).toHaveBeenCalledTimes(1);
  await act(async () => { root.update(element(spec)); });
  expect(mockTiming).toHaveBeenCalledTimes(1);
  await act(async () => { root.update(element({ ...spec })); });
  expect(mockTiming).toHaveBeenCalledTimes(2);
  await act(async () => { root.update(element(spec)); });
  expect(mockTiming).toHaveBeenCalledTimes(3);
  expect(mockValues).toHaveLength(1);
  expect(mockCancel).toHaveBeenCalledWith(phase);
  await act(async () => { root.unmount(); });
});

it('applies theme selection from the press handler while preserving card and pulse owners', async () => {
  let root: any;
  const props = stepProps();
  await act(async () => { root = create(React.createElement(ThemeStep, props)); });
  const cards = root.root.findAllByType('Pressable').filter((node: any) => node.props.accessibilityState);
  expect(cards).toHaveLength(4);
  const count = mockValues.length;
  await act(async () => { cards[1].props.onPress(); });
  expect(mockSetThemeName).toHaveBeenCalledWith('day');
  await act(async () => { root.update(React.createElement(ThemeStep, props)); });
  const next = root.root.findAllByType('Pressable').filter((node: any) => node.props.accessibilityState);
  expect(next).toEqual(cards);
  expect(next[1].props.accessibilityState.selected).toBe(true);
  expect(next[0].props.accessibilityState.selected).toBe(false);
  expect(mockValues).toHaveLength(count);
  await act(async () => { root.unmount(); });
});
