import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../state/PreferencesContext';
import { useTranslation } from '../../i18n';
import { MAX_DAYS, MIN_DAYS } from '../content';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';
import { selectionTick } from '../../utils/haptics';

export default function L2DaysStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [days, setDays] = useState(answers.days ?? MIN_DAYS);

  const change = (delta: number) => {
    const next = Math.min(MAX_DAYS, Math.max(MIN_DAYS, days + delta));
    if (next !== days) {
      selectionTick();
      setDays(next);
    }
  };

  return (
    <StepShell
      step="L2_days"
      role={answers.role}
      title={t('onboarding.l2.title')}
      onBack={onBack}
      onSkip={onSkip}
      footer={<PrimaryButton label={t('onboarding.next')} onPress={() => onAnswer({ days })} />}
    >
      <View style={styles.stepper}>
        <Pressable
          accessibilityRole="button"
          disabled={days <= MIN_DAYS}
          onPress={() => change(-1)}
          style={[styles.stepBtn, { borderColor: colors.border }]}
        >
          <Text style={[styles.stepBtnText, { color: colors.textPrimary }]}>−</Text>
        </Pressable>
        <Text style={[styles.count, { color: colors.accent }]}>
          {t('onboarding.l2.days', { count: days })}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={days >= MAX_DAYS}
          onPress={() => change(1)}
          style={[styles.stepBtn, { borderColor: colors.border }]}
        >
          <Text style={[styles.stepBtnText, { color: colors.textPrimary }]}>+</Text>
        </Pressable>
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginTop: 40 },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 24, fontWeight: '600' },
  count: { fontSize: 32, fontWeight: '700', minWidth: 110, textAlign: 'center' },
});
