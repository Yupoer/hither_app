import React from 'react';
import { Segmented } from '../screens/MapScreen/components/Segmented';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => {
    root: {
      findAllByProps: (props: Record<string, unknown>) => Array<{ props: Record<string, any> }>;
    };
  };
};

jest.mock('react-native', () => {
  return {
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: unknown) => styles },
    Text: 'Text',
    View: 'View',
  };
});

jest.mock('../a11y/useFontScaleBucket', () => ({
  useFontLayout: () => ({ scale: 1, boldText: false }),
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    Easing: { out: () => ({ cubic: () => undefined }) },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withTiming: (value: number) => value,
  };
});

describe('Segmented', () => {
  it('dispatches each option and exposes selected/disabled accessibility state', () => {
    const options = [
      { key: 'members', label: 'Members' },
      { key: 'route', label: 'Route' },
      { key: 'tools', label: 'Tools' },
    ];
    const onChange = jest.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(Segmented, {
          accent: '#fff',
          options,
          value: 'members',
          onChange,
        }),
      );
    });

    const getSegments = () =>
      renderer.root.findAllByProps({ accessibilityRole: 'button' });
    expect(getSegments().map((segment) => segment.props.accessibilityLabel)).toEqual(
      options.map((option) => option.label),
    );

    options.forEach((option, index) => {
      act(() => getSegments()[index].props.onPress());
      expect(onChange).toHaveBeenLastCalledWith(option.key);
      expect(getSegments()[index].props.accessibilityState).toEqual({
        selected: true,
        disabled: false,
      });
    });

    const disabledOnChange = jest.fn();
    const onDisabledPress = jest.fn();
    let disabledRenderer: ReturnType<typeof create>;
    act(() => {
      disabledRenderer = create(
        React.createElement(Segmented, {
          accent: '#fff',
          options,
          value: 'members',
          onChange: disabledOnChange,
          disabledKeys: ['tools'],
          onDisabledPress,
        }),
      );
    });
    const getDisabledSegments = () =>
      disabledRenderer.root.findAllByProps({ accessibilityRole: 'button' });
    expect(getDisabledSegments().map((segment) => segment.props.accessibilityState)).toEqual([
      { selected: true, disabled: false },
      { selected: false, disabled: false },
      { selected: false, disabled: true },
    ]);

    act(() => getDisabledSegments()[2].props.onPress());
    expect(onDisabledPress).toHaveBeenCalledWith('tools');
    expect(disabledOnChange).not.toHaveBeenCalledWith('tools');
  });
});
