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
      kicker={t('onboarding.l2.kicker')}
      title={t('onboarding.l2.title')}
      subtitle={t('onboarding.l2.subtitle')}
      onBack={onBack}
      onSkip={onSkip}
      footer={<PrimaryButton label={t('onboarding.continue')} onPress={() => onAnswer({ days })} />}
    >
      <View style={styles.center}>
        <View style={styles.stepperRow}>
          <Pressable
            accessibilityRole="button"
            disabled={days <= MIN_DAYS}
            onPress={() => change(-1)}
            style={[styles.stepBtn, { borderColor: colors.border, opacity: days <= MIN_DAYS ? 0.4 : 1 }]}
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
            style={[styles.stepBtn, { borderColor: colors.border, opacity: days >= MAX_DAYS ? 0.4 : 1 }]}
          >
            <Text style={[styles.stepBtnText, { color: colors.textPrimary }]}>+</Text>
          </Pressable>
        </View>
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', marginTop: 48 },
  // − [ days ] + on one line: number centered, steppers pinned to the sides.
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  count: { minWidth: 140, fontSize: 56, fontWeight: '800', textAlign: 'center' },
  stepBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 28, fontWeight: '600' },
});
