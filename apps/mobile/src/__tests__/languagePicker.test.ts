import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => {
    root: {
      findAllByProps: (props: Record<string, unknown>) => Array<{ props: Record<string, any> }>;
    };
    update: (element: React.ReactElement) => void;
  };
};

const mockSetLanguage = jest.fn();
let mockLanguage: 'zh' | 'en' = 'zh';

jest.mock('react-native', () => {
  const ActionSheetIOS = { showActionSheetWithOptions: jest.fn() };
  const Alert = { alert: jest.fn() };
  const Platform = { OS: 'ios' };
  return {
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    View: 'View',
    ActionSheetIOS,
    Alert,
    Platform,
  };
});

jest.mock('../state/PreferencesContext', () => ({
  usePreferences: () => ({
    language: mockLanguage,
    setLanguage: mockSetLanguage,
  }),
}));

jest.mock('../i18n', () => ({
  useTranslation: () => ({
    language: mockLanguage,
    t: (key: string) => key,
  }),
}));

jest.mock('../utils/haptics', () => ({
  lightTap: jest.fn(),
}));

const mockOnSelect = { current: null as null | ((id: string) => void) };
jest.mock('../native/menu', () => {
  const React = require('react');
  return {
    isNativeMenuAvailable: () => true,
    NativeMenuHost: ({
      items,
      onSelect,
      children,
      accessibilityLabel,
    }: {
      items: Array<{ id: string; title: string }>;
      onSelect: (id: string) => void;
      children: React.ReactNode;
      accessibilityLabel?: string;
    }) => {
      mockOnSelect.current = onSelect;
      return React.createElement(
        'View',
        { accessibilityRole: 'button', accessibilityLabel, items },
        children,
      );
    },
  };
});

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { lightTap } from '../utils/haptics';
import LanguagePicker from '../components/LanguagePicker';
import { showLanguageChoice } from '../utils/showLanguageChoice';

describe('LanguagePicker', () => {
  beforeEach(() => {
    mockSetLanguage.mockClear();
    mockLanguage = 'zh';
    (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mockReset();
    (Alert.alert as jest.Mock).mockReset();
    (lightTap as jest.Mock).mockClear();
    Platform.OS = 'ios';
  });

  it('calls setLanguage for zh and en without a restart path', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(LanguagePicker));
    });

    const buttons = renderer!.root.findAllByProps({ accessibilityRole: 'button' });
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual(['中文', 'English']);
    expect(buttons[0].props.accessibilityState).toEqual({ selected: true });
    expect(buttons[1].props.accessibilityState).toEqual({ selected: false });

    act(() => buttons[1].props.onPress());
    expect(mockSetLanguage).toHaveBeenCalledWith('en');

    mockLanguage = 'en';
    act(() => {
      renderer.update(React.createElement(LanguagePicker));
    });
    const updated = renderer!.root.findAllByProps({ accessibilityRole: 'button' });
    expect(updated[1].props.accessibilityState).toEqual({ selected: true });

    act(() => updated[0].props.onPress());
    expect(mockSetLanguage).toHaveBeenLastCalledWith('zh');
    expect(mockSetLanguage).not.toHaveBeenCalledWith(expect.stringMatching(/restart/i));
  });

  it('shows the current language plus a chevron on the menu trigger', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(LanguagePicker, { variant: 'menu' }));
    });

    const buttons = renderer!.root.findAllByProps({ accessibilityRole: 'button' });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.accessibilityLabel).toBe('中文');
    expect(renderer!.root.findAllByProps({ name: 'chevron-down' }).length).toBeGreaterThan(0);

    mockLanguage = 'en';
    act(() => {
      renderer.update(React.createElement(LanguagePicker, { variant: 'menu' }));
    });
    const updated = renderer!.root.findAllByProps({ accessibilityRole: 'button' });
    expect(updated[0].props.accessibilityLabel).toBe('English');
  });

  it('opens the native language choice and calls setLanguage for the other language', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(LanguagePicker, { variant: 'menu' }));
    });

    expect(ActionSheetIOS.showActionSheetWithOptions).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockOnSelect.current).toEqual(expect.any(Function));
    act(() => mockOnSelect.current?.('en'));
    expect(lightTap).toHaveBeenCalled();
    expect(mockSetLanguage).toHaveBeenCalledWith('en');
    expect(mockSetLanguage).not.toHaveBeenCalledWith(expect.stringMatching(/restart/i));
  });

  it('does not call setLanguage when the current language is selected', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(LanguagePicker, { variant: 'menu' }));
    });

    act(() => mockOnSelect.current?.('zh'));
    expect(mockSetLanguage).not.toHaveBeenCalled();
  });
});

describe('showLanguageChoice', () => {
  beforeEach(() => {
    (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mockReset();
    (Alert.alert as jest.Mock).mockReset();
    Platform.OS = 'ios';
  });

  it('maps iOS action sheet options and skips current or cancel', () => {
    const onSelect = jest.fn();
    showLanguageChoice({ current: 'zh', onSelect, cancelLabel: 'Cancel' });
    expect(ActionSheetIOS.showActionSheetWithOptions).toHaveBeenCalledWith(
      {
        options: ['Cancel', '中文', 'English'],
        cancelButtonIndex: 0,
        userInterfaceStyle: 'dark',
      },
      expect.any(Function),
    );
    const cb = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls[0][1];
    cb(0);
    cb(1);
    cb(undefined);
    cb(99);
    expect(onSelect).not.toHaveBeenCalled();
    cb(2);
    expect(onSelect).toHaveBeenCalledWith('en');
  });

  it('maps Android alert buttons and skips current or cancel', () => {
    Platform.OS = 'android';
    const onSelect = jest.fn();
    showLanguageChoice({ current: 'en', onSelect, cancelLabel: 'Cancel' });
    expect(Alert.alert).toHaveBeenCalled();
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    expect(buttons.map((b) => b.text)).toEqual(['中文', 'English', 'Cancel']);
    expect(buttons[2].style).toBe('cancel');
    buttons[1].onPress?.();
    expect(onSelect).not.toHaveBeenCalled();
    buttons[0].onPress?.();
    expect(onSelect).toHaveBeenCalledWith('zh');
    buttons[2].onPress?.();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
