import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { themes, THEME_ORDER, type ThemeName } from '../../theme';
import { usePreferences, useTheme } from '../../state/PreferencesContext';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';
import { selectionTick } from '../../utils/haptics';

// Rounded display face shared with the map / gathering-point cards (Latin only;
// CJK falls back to system, just larger). Loaded in App.tsx.
const DISPLAY_FONT = 'Fredoka_600SemiBold';
// Warm off-white (米白) that replaces the stark pure-white of the light theme.
const MILK_WHITE = '#F5F0E4';

const THEME_LABEL_KEY: Record<ThemeName, TranslationKey> = {
  night: 'onboarding.theme.night',
  day: 'onboarding.theme.day',
  dusk: 'onboarding.theme.dusk',
  forest: 'onboarding.theme.forest',
};

export default function ThemeStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { colors, themeName } = useTheme();
  const { setThemeName } = usePreferences();
  const { t } = useTranslation();

  // The light ("day") theme's near-white background reads too stark here — warm
  // it to 米白. Dark themes keep their own background so text stays readable.
  const background = themeName === 'day' ? MILK_WHITE : colors.background;

  return (
    <StepShell
      step="theme"
      role={answers.role}
      kicker={t('onboarding.theme.kicker')}
      title={t('onboarding.theme.title')}
      subtitle={t('onboarding.theme.subtitle')}
      onBack={onBack}
      onSkip={onSkip}
      background={background}
      footer={
        <PrimaryButton
          label={t('onboarding.continue')}
          onPress={() => onAnswer({ theme: themeName })}
        />
      }
    >
      <View style={styles.grid}>
        {THEME_ORDER.map((name) => {
          const palette = themes[name];
          const selected = themeName === name;
          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              onPress={() => {
                selectionTick();
                setThemeName(name);
              }}
              // The tile IS the theme colour — a solid accent swatch, no emoji
              // or dot. Selection reads as a ring + slight scale-up.
              style={[
                styles.card,
                {
                  backgroundColor: palette.accent,
                  borderColor: selected ? palette.textPrimary : 'transparent',
                  borderWidth: selected ? 3 : 0,
                  transform: [{ scale: selected ? 1.05 : 1 }],
                },
              ]}
            >
              <Text style={[styles.cardLabel, { color: palette.accentText }]}>
                {t(THEME_LABEL_KEY[name])}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between' },
  card: {
    width: '47%',
    aspectRatio: 1.2,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: { fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: '600' },
});
