import React from 'react';
import * as ReactNative from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import OverflowMarquee from '../components/OverflowMarquee';

jest.mock('../state/foregroundUi', () => ({ useOptionalVisuals: () => true }));
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useSharedValue: (value: number) => jest.requireActual<typeof React>('react').useRef({ value }).current,
  useReducedMotion: () => false,
}));

describe('marquee text scaling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1.8 });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([
    { allowFontScaling: true, clipHeight: 25 },
    { allowFontScaling: false, clipHeight: 20 },
  ])('uses the same scaling for measurement, static and moving text when scaling is $allowFontScaling', ({ allowFontScaling, clipHeight }) => {
    const screen = render(<OverflowMarquee text="A long gathering destination title" style={{ fontSize: 16, lineHeight: 20 }} allowFontScaling={allowFontScaling} />);
    const expectScaling = (textCount = 2) => {
      const texts = screen.UNSAFE_getAllByType(ReactNative.Text);
      expect(texts).toHaveLength(textCount);
      for (const text of texts) {
        expect(text.props.allowFontScaling).toBe(allowFontScaling);
        expect(text.props.maxFontSizeMultiplier).toBe(1.25);
      }
      expect(ReactNative.StyleSheet.flatten(screen.UNSAFE_getAllByType(ReactNative.View)[0].props.style).height).toBe(clipHeight);
      return texts;
    };
    const texts = expectScaling();
    expect(texts[1].props.numberOfLines).toBe(1);
    const viewport = screen.UNSAFE_getAllByType(ReactNative.View).find(view => view.props.onLayout);
    fireEvent(viewport!, 'layout', { nativeEvent: { layout: { width: 100 } } });
    fireEvent(texts[0], 'textLayout', { nativeEvent: { lines: [{ width: 300 }] } });
    act(() => jest.advanceTimersByTime(1600));
    expect(expectScaling(3)[1].props.numberOfLines).toBeUndefined();
  });
});
