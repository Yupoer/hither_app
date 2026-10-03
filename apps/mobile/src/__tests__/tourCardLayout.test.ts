import React from 'react';
import { act, create } from 'react-test-renderer';
import { placeTourCard } from '../featureTour/overlayLayout';
import { measureTargetWithRetry } from '../featureTour/measureTarget';

const mockWindow = { width: 390, height: 844, fontScale: 1 };
const mockLayout = { textScale: 1, boldText: false };
const mockLiquidGlassAvailable = jest.fn(() => true);
const keyboardListeners = new Map<string, (event: any) => void>();
jest.mock('../a11y/useFontScaleBucket', () => ({ useFontLayout: () => mockLayout }));
jest.mock('../state/foregroundUi', () => ({ useForegroundUi: () => true }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../native', () => ({ liquidGlass: { isLiquidGlassAvailable: () => mockLiquidGlassAvailable() } }));
jest.mock('@expo/ui/swift-ui', () => ({ Host: 'Host', Button: 'Button', Text: 'SwiftText', VStack: 'VStack', HStack: 'HStack', Spacer: 'Spacer' }));
jest.mock('@expo/ui/swift-ui/modifiers', () => Object.fromEntries(['accessibilityLabel', 'background', 'buttonStyle', 'buttonBorderShape', 'cornerRadius', 'disabled', 'dynamicTypeSize', 'font', 'foregroundColor', 'frame', 'glassEffect', 'padding', 'lineLimit', 'minimumScaleFactor'].map((name) => [name, (value: unknown) => ({ name, value })])));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1, absoluteFill: { position: 'absolute' } },
  useWindowDimensions: () => mockWindow, findNodeHandle: () => null,
  Keyboard: { addListener: (name: string, callback: (event: any) => void) => { keyboardListeners.set(name, callback); return { remove: () => keyboardListeners.delete(name) }; } },
  BackHandler: { addEventListener: () => ({ remove() {} }) }, AccessibilityInfo: { setAccessibilityFocus() {} },
  Animated: { Value: class { setValue() {} }, View: 'Animated.View', timing: () => ({ start: (callback?: () => void) => callback?.() }) },
}));

const TourCard = require('../featureTour/TourCard').default;
const NativeTourCard = require('../featureTour/TourCard.ios').default;
const { GroupFeatureTourOverlay } = require('../featureTour/GroupFeatureTourOverlay');
const flatten = (value: any): any => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value ?? {};
const props = { title: 'Complete title', body: 'Long complete copy '.repeat(100), ctaLabel: 'Next', prevLabel: 'Previous', canGoPrev: true, ctaDisabled: false, onPrev: jest.fn(), onNext: jest.fn(), accessibilityLabel: 'Complete copy', maxHeight: 220 };

afterEach(() => { jest.useRealTimers(); mockWindow.width = 390; mockWindow.height = 844; mockLayout.textScale = 1; mockLiquidGlassAvailable.mockReturnValue(true); });

it.each([['RN', TourCard], ['native SwiftUI', NativeTourCard]])('keeps %s 55pt controls outside the bounded long-copy scroll', async (_platform, Component) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(Component, props)); });
  const scroll = tree.root.findByProps({ testID: 'tour-copy' });
  expect(flatten(scroll.props.style).flexGrow).toBe(0);
  expect(scroll.findAll((node) => node.props.testID === 'tour-next' || node.props.testID === 'tour-prev')).toHaveLength(0);
  const next = tree.root.findByProps({ testID: 'tour-next' });
  const prev = tree.root.findByProps({ testID: 'tour-prev' });
  expect(next.props.onPress).toBe(props.onNext); expect(prev.props.onPress).toBe(props.onPrev);
  if (_platform === 'RN') {
    expect(flatten(next.props.style({ pressed: false })).height).toBe(55);
    expect(flatten(prev.props.style({ pressed: false })).height).toBe(55);
  } else {
    const hosts = tree.root.findAll((node) => String(node.type) === 'Host' && node.props.pointerEvents !== 'none');
    expect(hosts).toHaveLength(2);
    for (const host of hosts) {
      expect(host.props.matchContents).toEqual({ vertical: true });
      expect(flatten(host.props.style).width).toBe('100%');
    }
    expect(next.props.modifiers).toContainEqual({ name: 'frame', value: { minWidth: 0, maxWidth: Infinity, height: 55 } });
    expect(next.props.modifiers).toContainEqual({ name: 'font', value: { size: 20, weight: 'semibold' } });
    for (const button of [prev, next]) {
      const label = button.find((node) => String(node.type) === 'SwiftText');
      expect(label.props.modifiers).toContainEqual({ name: 'lineLimit', value: 1 });
      expect(label.props.modifiers).toContainEqual({ name: 'minimumScaleFactor', value: 0.8 });
    }
  }
  expect(tree.root.findAll((node) => flatten(node.props.style).maxHeight === 220).length).toBeGreaterThan(0);
  await act(async () => tree.unmount());
});

it('bounds measured placement by viewport and keyboard, invalidating stale height on resize and fonts', async () => {
  let tree!: ReturnType<typeof create>;
  const overlayProps = { visible: true, title: props.title, body: props.body, ctaLabel: 'Next', targetRect: null, onNext: jest.fn(), reduceMotion: true };
  await act(async () => { tree = create(React.createElement(GroupFeatureTourOverlay, overlayProps)); });
  let card = tree.root.findByType(TourCard);
  expect(card.props.maxHeight).toBe(844 - 47 - 34 - 24);
  const measured = tree.root.findAll((node) => typeof node.props.onLayout === 'function')[0];
  await act(async () => measured.props.onLayout({ nativeEvent: { layout: { height: 500 } } }));
  mockWindow.width = 320; mockWindow.height = 568; mockWindow.fontScale = 1.25; mockLayout.textScale = 1.2;
  await act(async () => { tree.update(React.createElement(GroupFeatureTourOverlay, overlayProps)); });
  card = tree.root.findByType(TourCard);
  expect(card.props.maxHeight).toBe(568 - 47 - 34 - 24);
  expect(card.props.textScale).toBe(1.2); expect(card.props.fontScale).toBe(1.25);
  await act(async () => { keyboardListeners.get('keyboardDidShow')!({ endCoordinates: { screenY: 300, height: 268 } }); });
  card = tree.root.findByType(TourCard);
  expect(card.props.maxHeight).toBe(300 - 47 - 34 - 24);
  const placement = placeTourCard({ hole: null, windowWidth: 320, windowHeight: 300, insets: { top: 47, bottom: 34 }, cardHeight: 500 });
  expect(placement.cardTop + placement.maxCardHeight).toBeLessThanOrEqual(300 - 34 - 12);
  await act(async () => tree.unmount());
});

it('keeps older iOS tour copy and exit controls in native RN views across avatar, settings and final steps', async () => {
  mockLiquidGlassAvailable.mockReturnValue(false);
  const onNext = jest.fn();
  const onPrev = jest.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(NativeTourCard, { ...props, onNext, onPrev })); });
  for (const [title, ctaLabel] of [['Avatar', 'Next'], ['Settings', 'Next'], ['', 'Get started']]) {
    await act(async () => { tree.update(React.createElement(NativeTourCard, { ...props,
      title, body: 'Complete tour copy.', ctaLabel, onNext, onPrev })); });
    expect(tree.root.findAll((node) => String(node.type) === 'Host')).toHaveLength(0);
    const next = tree.root.findByProps({ testID: 'tour-next' });
    const prev = tree.root.findByProps({ testID: 'tour-prev' });
    expect(flatten(next.props.style({ pressed: false })).height).toBe(55);
    expect(next.props.accessibilityLabel).toBe(ctaLabel);
    expect(tree.root.findAll((node) => String(node.type) === 'Text' && node.props.children === 'Complete tour copy.')).toHaveLength(1);
    await act(async () => { next.props.onPress(); prev.props.onPress(); });
  }
  expect(onNext).toHaveBeenCalledTimes(3); expect(onPrev).toHaveBeenCalledTimes(3);
  await act(async () => { tree.update(React.createElement(NativeTourCard, { ...props,
    title: 'Settings', ctaDisabled: true, onNext, onPrev })); });
  expect(tree.root.findByProps({ testID: 'tour-next' }).props.disabled).toBe(true);
  expect(tree.root.findByProps({ testID: 'tour-prev' }).props.disabled).toBe(true);
  await act(async () => tree.unmount());
});

it('recreates tour content hosts for a new step while keeping the current step mounted on remeasurement', async () => {
  let tree!: ReturnType<typeof create>;
  const overlayProps = { visible: true, title: 'Avatar', body: 'Edit your profile.',
    ctaLabel: 'Next', targetRect: { x: 300, y: 420, width: 46, height: 46 },
    onNext: jest.fn(), canGoPrev: true, reduceMotion: true };
  await act(async () => { tree = create(React.createElement(GroupFeatureTourOverlay, overlayProps)); });
  const avatarCard = tree.root.findByType(TourCard);
  const settingsProps = { ...overlayProps, title: 'Settings', body: 'Language and location controls.',
    targetRect: { x: 250, y: 420, width: 46, height: 46 } };
  await act(async () => { tree.update(React.createElement(GroupFeatureTourOverlay, settingsProps)); });
  const settingsCard = tree.root.findByType(TourCard);
  expect(settingsCard).not.toBe(avatarCard);
  expect(settingsCard.props.title).toBe('Settings');
  expect(settingsCard.findByProps({ testID: 'tour-next' }).props.onPress).toBe(overlayProps.onNext);
  await act(async () => { tree.update(React.createElement(GroupFeatureTourOverlay,
    { ...settingsProps, targetRect: { ...settingsProps.targetRect, y: 425 } })); });
  expect(tree.root.findByType(TourCard)).toBe(settingsCard);
  await act(async () => tree.unmount());
});

it('uses geometry rather than its measured height as the copy bound', () => {
  const input = { hole: { x: 20, y: 60, w: 280, h: 640 }, windowWidth: 320, windowHeight: 760, insets: { top: 47, bottom: 34 } };
  const short = placeTourCard({ ...input, cardHeight: 160 });
  const long = placeTourCard({ ...input, cardHeight: 600 });
  expect(short.maxCardHeight).toBe(long.maxCardHeight);
  expect(long.cardTop + Math.min(600, long.maxCardHeight)).toBeLessThanOrEqual(760 - 34 - 12);
});

it('constrains both English footer labels to shared row width with single-line readable fitting at large type', async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(TourCard, { ...props, prevLabel: 'Previous', ctaLabel: 'Get started', textScale: 1.2 })); });
  const next = tree.root.findByProps({ testID: 'tour-next' });
  const prev = tree.root.findByProps({ testID: 'tour-prev' });
  expect(flatten(next.props.style({ pressed: false })).flex).toBe(1);
  expect(flatten(prev.parent!.props.style).flex).toBe(1);
  for (const button of [prev, next]) {
    const text = button.find((node) => String(node.type) === 'Text');
    expect(text.props.numberOfLines).toBe(1);
    expect(text.props.adjustsFontSizeToFit).toBe(true);
    expect(text.props.minimumFontScale).toBe(0.8);
    expect(text.props.maxFontSizeMultiplier).toBe(1.25);
    expect(flatten(text.props.style).fontSize).toBe(24);
  }
  await act(async () => tree.unmount());
});

it('bounds a never-callback measurement and rejected target before trying its stable parent', async () => {
  jest.useFakeTimers();
  const parent = { x: 10, y: 20, width: 280, height: 220 };
  const measure = jest.fn((target: string) => target === 'gatherCard' ? Promise.resolve(parent) : new Promise<null>(() => {}));
  const pending = measureTargetWithRetry({ measure, target: 'navCommand', maxAttempts: 2, retryDelayMs: 0, measureTimeoutMs: 40 });
  await jest.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toEqual(parent);
  expect(measure).toHaveBeenCalledTimes(3);
  await expect(measureTargetWithRetry({ measure: () => Promise.reject(new Error('native view detached')), target: 'settings', maxAttempts: 1 })).resolves.toBeNull();
});

// Long measured copy must stay within both narrow phones and landscape budgets.
it.each([[320,568],[375,812],[390,844],[414,896],[844,390]])('bounds long cards at %s x %s with keyboard and target positions', (width,height) => {
  for (const keyboard of [false,true]) {
    const availableHeight = keyboard ? Math.max(240, height - 240) : height;
    for (const y of [50,availableHeight / 2,availableHeight - 70]) {
      const placement = placeTourCard({ windowWidth: width, windowHeight: availableHeight,
        insets: { top: 47, bottom: 34 }, cardHeight: 900,
        hole: { x: 20, y, w: width - 40, h: 44 } });
      expect(placement.cardTop).toBeGreaterThanOrEqual(59);
      expect(placement.cardTop + placement.maxCardHeight).toBeLessThanOrEqual(availableHeight - 46);
    }
  }
});
