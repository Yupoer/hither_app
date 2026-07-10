import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { themes, THEME_ORDER, type ThemeName } from '../../theme';
import { usePreferences, useTheme } from '../../state/PreferencesContext';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';
import { selectionTick } from '../../utils/haptics';

const THEME_LABEL_KEY: Record<ThemeName, TranslationKey> = {
  night: 'onboarding.theme.night',
  day: 'onboarding.theme.day',
  dusk: 'onboarding.theme.dusk',
  forest: 'onboarding.theme.forest',
};

export default function ThemeStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { colors } = useTheme();
  const { themeName, setThemeName } = usePreferences();
  const { t } = useTranslation();

  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(colors.background, { duration: 350 }),
  }));

  return (
    <Animated.View style={[styles.fill, bgStyle]}>
      <StepShell
        step="theme"
        role={answers.role}
        title={t('onboarding.theme.title')}
        onBack={onBack}
        onSkip={onSkip}
        footer={
          <PrimaryButton
            label={t('onboarding.next')}
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
                style={[
                  styles.card,
                  {
                    backgroundColor: palette.surface,
                    borderColor: selected ? palette.accent : palette.border,
                    borderWidth: selected ? 2.5 : StyleSheet.hairlineWidth,
                    transform: [{ scale: selected ? 1.05 : 1 }],
                  },
                ]}
              >
                <View style={[styles.swatch, { backgroundColor: palette.accent }]} />
                <Text style={[styles.cardLabel, { color: palette.textPrimary }]}>
                  {t(THEME_LABEL_KEY[name])}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </StepShell>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between' },
  card: {
    width: '47%',
    aspectRatio: 1.2,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  cardLabel: { fontSize: 14, fontWeight: '600' },
});
