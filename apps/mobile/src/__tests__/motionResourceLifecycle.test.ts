import React from 'react';

let mockVisuals = true;
let mockReducedMotion = false;
const mockValues: { value: number }[] = [];
const mockCancel = jest.fn();
const mockTiming = jest.fn((value: number) => value);
jest.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value }, View: 'View', Pressable: 'Pressable', Image: 'Image',
}));
jest.mock('../state/foregroundUi', () => ({
  useOptionalVisuals: () => mockVisuals, useAppState: () => 'active',
}));
jest.mock('../state/PreferencesContext', () => ({ useTheme: () => ({ colors: { accent: '#ffffff' } }) }));
jest.mock('../a11y/useFontScaleBucket', () => ({ useFontLayout: () => ({ scale: 1 }) }));
jest.mock('../components/HitherText', () => ({ HitherText: 'Text' }));
jest.mock('../utils/haptics', () => ({ mediumTap: jest.fn() }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (value: string) => value }) }));
jest.mock('../onboarding/steps/StepShell', () => 'StepShell');
jest.mock('../onboarding/icons', () => ({ OnboardingIcons: { mascot: {} } }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView', createAnimatedComponent: (value: unknown) => value },
  cancelAnimation: (value: unknown) => mockCancel(value),
  withTiming: (value: number) => mockTiming(value), withRepeat: (value: number) => value,
  useReducedMotion: () => mockReducedMotion,
  Easing: { linear: 'linear' }, interpolate: () => 1, interpolateColor: () => '#fff',
  useAnimatedStyle: () => ({}),
  useSharedValue: (value: number) => {
    const ref = require('react').useRef(null);
    if (!ref.current) { ref.current = { value }; mockValues.push(ref.current); }
    return ref.current;
  },
}));
import WaveLoading from '../components/WaveLoading';
import PrimaryButton from '../onboarding/steps/PrimaryButton';
import MascotStep from '../onboarding/steps/MascotStep';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => { mockVisuals = true; mockReducedMotion = false; mockValues.length = 0; jest.clearAllMocks(); });

it('retains loading phase and dot instances while policy cancels and resumes the wave', async () => {
  let root: any;
  await act(async () => { root = create(React.createElement(WaveLoading, { color: '#fff' })); });
  const phase = mockValues[0];
  const dot = root.root.findAllByType('AnimatedView')[0];
  expect(phase.value).toBe(1);
  mockVisuals = false;
  await act(async () => { root.update(React.createElement(WaveLoading, { color: '#abc', size: 48 })); });
  expect(mockCancel).toHaveBeenCalledWith(phase);
  expect(phase.value).toBe(0);
  expect(root.root.findAllByType('AnimatedView')[0]).toBe(dot);
  expect(mockValues).toHaveLength(1);
  mockVisuals = true;
  await act(async () => { root.update(React.createElement(WaveLoading, { color: '#abc' })); });
  expect(phase.value).toBe(1);
  await act(async () => { root.unmount(); });
  expect(mockCancel).toHaveBeenLastCalledWith(phase);
});

it('changes disabled color without remounting the primary button or restarting on label updates', async () => {
  let root: any;
  const onPress = jest.fn();
  const element = (disabled: boolean, label = 'Continue') => React.createElement(PrimaryButton, { disabled, label, onPress });
  await act(async () => { root = create(element(true)); });
  const button = root.root.findByType('Pressable');
  const progress = mockValues[0];
  expect(progress.value).toBe(0);
  await act(async () => { root.update(element(false)); });
  expect(root.root.findByType('Pressable')).toBe(button);
  expect(progress.value).toBe(1);
  const count = mockTiming.mock.calls.length;
  await act(async () => { root.update(element(false, 'Finish')); });
  expect(mockTiming).toHaveBeenCalledTimes(count);
  await act(async () => { root.unmount(); });
  expect(mockCancel).toHaveBeenLastCalledWith(progress);
});

it('keeps mascot content mounted when visuals suspend and completed entrance stays settled on resume', async () => {
  let root: any;
  const props: React.ComponentProps<typeof MascotStep> = {
    answers: { quiz: { F1: 'A', F2: 'B', F3: 'A' } },
    onAnswer: jest.fn(), onSkip: jest.fn(), onBack: jest.fn(),
  };
  await act(async () => { root = create(React.createElement(MascotStep, props)); });
  const card = root.root.findByType('AnimatedView');
  const progress = mockValues[0];
  expect(progress.value).toBe(1);
  mockVisuals = false;
  await act(async () => { root.update(React.createElement(MascotStep, props)); });
  expect(root.root.findByType('AnimatedView')).toBe(card);
  expect(mockCancel).toHaveBeenCalledWith(progress);
  const count = mockTiming.mock.calls.length;
  mockVisuals = true;
  await act(async () => { root.update(React.createElement(MascotStep, props)); });
  expect(mockTiming).toHaveBeenCalledTimes(count);
  expect(mockValues).toHaveLength(1);
  await act(async () => { root.unmount(); });
});
