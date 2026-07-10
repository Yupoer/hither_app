import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation, type TranslationKey } from '../../i18n';
import { PURPOSE_OPTIONS, type PurposeOption } from '../content';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import OptionCard from './OptionCard';

const LABEL_KEY: Record<PurposeOption, TranslationKey> = {
  abroad: 'onboarding.l1.abroad',
  city: 'onboarding.l1.city',
  family: 'onboarding.l1.family',
  friends: 'onboarding.l1.friends',
};

export default function L1PurposeStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { t } = useTranslation();
  return (
    <StepShell
      step="L1_purpose"
      role={answers.role}
      title={t('onboarding.l1.title')}
      onBack={onBack}
      onSkip={onSkip}
    >
      <View style={styles.grid}>
        {PURPOSE_OPTIONS.map((opt) => (
          <View key={opt} style={styles.cell}>
            <OptionCard
              title={t(LABEL_KEY[opt])}
              selected={answers.purpose === opt}
              onPress={() => onAnswer({ purpose: opt })}
            />
          </View>
        ))}
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', paddingHorizontal: 4 },
});
