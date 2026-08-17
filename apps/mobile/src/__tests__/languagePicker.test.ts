import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => {
    root: {
      findAllByProps: (props: Record<string, unknown>) => Array<{ props: Record<string, any> }>;
    };
  };
};

const mockSetLanguage = jest.fn();
let mockLanguage: 'zh' | 'en' = 'zh';

jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
}));

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

import LanguagePicker from '../components/LanguagePicker';

describe('LanguagePicker', () => {
  beforeEach(() => {
    mockSetLanguage.mockClear();
    mockLanguage = 'zh';
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
});
