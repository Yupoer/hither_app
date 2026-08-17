import { ActionSheetIOS, Alert, Platform } from 'react-native';
import type { Language } from '../state/PreferencesContext';

export const LANGUAGE_CHOICES: { key: Language; label: string }[] = [
  { key: 'zh', label: '中文' },
  { key: 'en', label: 'English' },
];

export function showLanguageChoice({
  current,
  onSelect,
  cancelLabel,
}: {
  current: Language;
  onSelect: (language: Language) => void;
  cancelLabel: string;
}): void {
  const select = (key: Language) => {
    if (key === current) return;
    onSelect(key);
  };

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [cancelLabel, ...LANGUAGE_CHOICES.map((choice) => choice.label)],
        cancelButtonIndex: 0,
        userInterfaceStyle: 'dark',
      },
      (buttonIndex) => {
        if (buttonIndex == null || buttonIndex === 0) return;
        const picked = LANGUAGE_CHOICES[buttonIndex - 1];
        if (!picked) return;
        select(picked.key);
      },
    );
    return;
  }

  Alert.alert(
    '',
    undefined,
    [
      ...LANGUAGE_CHOICES.map((choice) => ({
        text: choice.label,
        onPress: () => select(choice.key),
      })),
      { text: cancelLabel, style: 'cancel' as const },
    ],
  );
}
