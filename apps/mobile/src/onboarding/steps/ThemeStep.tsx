import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
              accessibilityState={{ selected }}
              onPress={() => {
                selectionTick();
                setThemeName(name);
              }}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: palette.accent },
                // Design System: depth via a colored glow, not white borders.
                selected && { ...styles.cardGlow, shadowColor: palette.accent },
                selected && { transform: [{ scale: 1.04 }] },
                pressed && { opacity: 0.9 },
              ]}
            >
              {/* Soft top specular sheen — the Liquid-Glass highlight cue. */}
              <View style={styles.cardSheen} pointerEvents="none" />
              {/* Selection ring as an absolute overlay so it never reflows the
                  label (the old borderWidth toggle shifted the text). */}
              {selected ? <View style={styles.cardRing} pointerEvents="none" /> : null}
              <Text
                style={[styles.cardLabel, { color: palette.accentText }]}
                numberOfLines={1}
              >
                {t(THEME_LABEL_KEY[name])}
              </Text>
              {selected ? (
                <View style={[styles.cardCheck, { borderColor: palette.accentText }]}>
                  <Ionicons name="checkmark" size={14} color={palette.accentText} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between' },
  // DS card: generous 24px radius, solid theme-colour fill.
  card: {
    width: '47%',
    aspectRatio: 1.2,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardGlow: {
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 8,
  },
  cardSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  cardRing: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  cardLabel: { fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: '600' },
  cardCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
