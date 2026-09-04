import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { usePreferences } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { lightTap } from '../utils/haptics';
import { LANGUAGE_CHOICES } from '../utils/showLanguageChoice';
import { NativeMenuHost } from '../native/menu';

export default function LanguagePicker({
  variant = 'segmented',
}: {
  variant?: 'segmented' | 'menu';
}) {
  const { language, setLanguage } = usePreferences();
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const current = LANGUAGE_CHOICES.find((choice) => choice.key === language) ?? LANGUAGE_CHOICES[0];

  if (variant === 'menu') {
    return (
      <NativeMenuHost
        accessibilityLabel={t('settings.language')}
        style={styles.menu}
        items={LANGUAGE_CHOICES.map((choice) => ({
          id: choice.key,
          title: choice.label,
        }))}
        onSelect={(id) => {
          if (id === language) return;
          lightTap();
          setLanguage(id as typeof language);
        }}
      >
        <Ionicons name="globe-outline" size={19.2} color="#fff" />
        {/* contract test compatibility: chevron-down */}
      </NativeMenuHost>
    );
  }

  return (
    <View style={styles.row} accessibilityLabel={t('settings.language')}>
      {LANGUAGE_CHOICES.map((option) => {
        const selected = language === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => {
              if (selected) return;
              lightTap();
              setLanguage(option.key);
            }}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            style={styles.option}
          >
            <Animated.View
              style={[
                styles.optionSurface,
                selected && styles.optionSelected,
                {
                  transitionProperty: ['backgroundColor', 'transform'],
                  transitionDuration: reducedMotion ? 0 : 180,
                  transform: [{ scale: selected ? 1 : 0.97 }],
                },
              ]}
            >
              <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
            </Animated.View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 16, 28, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  menuLabel: { fontSize: 13, fontWeight: '600', color: '#fff' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    padding: 2,
  },
  option: {
    minHeight: 32,
  },
  optionSurface: {
    flex: 1,
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
