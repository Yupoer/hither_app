import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../state/PreferencesContext';
import { useTranslation, type TranslationKey } from '../../i18n';
import { accentMix } from '../../glass';
import { PREF_OPTIONS, type PrefOption } from '../content';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';
import { selectionTick } from '../../utils/haptics';

const LABEL_KEY: Record<PrefOption, TranslationKey> = {
  food: 'onboarding.f4.food',
  sights: 'onboarding.f4.sights',
  shopping: 'onboarding.f4.shopping',
  nature: 'onboarding.f4.nature',
  culture: 'onboarding.f4.culture',
  nightlife: 'onboarding.f4.nightlife',
};

export default function F4PrefsStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>(answers.prefs ?? []);

  const toggle = (opt: PrefOption) => {
    selectionTick();
    setSelected((prev) =>
      prev.includes(opt) ? prev.filter((p) => p !== opt) : [...prev, opt],
    );
  };

  return (
    <StepShell
      step="F4_prefs"
      role={answers.role}
      title={t('onboarding.f4.title')}
      onBack={onBack}
      onSkip={onSkip}
      footer={
        <PrimaryButton
          label={t('onboarding.continue')}
          disabled={selected.length === 0}
          onPress={() => onAnswer({ prefs: selected })}
        />
      }
    >
      <View style={styles.grid}>
        {PREF_OPTIONS.map((opt) => {
          const active = selected.includes(opt);
          return (
            <Pressable
              key={opt}
              accessibilityRole="button"
              onPress={() => toggle(opt)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? accentMix(colors.accent, 20) : colors.surface,
                  borderColor: active ? colors.accent : colors.border,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: colors.textPrimary }]}>
                {t(LABEL_KEY[opt])}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
});
