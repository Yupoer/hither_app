import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePreferences, type Language } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';

const OPTIONS: { key: Language; label: string }[] = [
  { key: 'zh', label: '中文' },
  { key: 'en', label: 'English' },
];

export default function LanguagePicker() {
  const { language, setLanguage } = usePreferences();
  const { t } = useTranslation();

  return (
    <View style={styles.row} accessibilityLabel={t('settings.language')}>
      {OPTIONS.map((option) => {
        const selected = language === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => setLanguage(option.key)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            style={[styles.option, selected && styles.optionSelected]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    padding: 3,
  },
  option: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSelected: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(235,235,245,0.7)',
  },
  labelSelected: {
    color: '#fff',
  },
});
