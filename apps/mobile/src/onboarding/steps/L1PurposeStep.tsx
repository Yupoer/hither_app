import React, { useState } from 'react';
import { useTranslation, type TranslationKey } from '../../i18n';
import { PURPOSE_OPTIONS, type PurposeOption } from '../content';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import OptionCard from './OptionCard';
import PrimaryButton from './PrimaryButton';

const LABEL_KEY: Record<PurposeOption, TranslationKey> = {
  abroad: 'onboarding.l1.abroad',
  city: 'onboarding.l1.city',
  family: 'onboarding.l1.family',
  friends: 'onboarding.l1.friends',
};

const EMOJI: Record<PurposeOption, string> = {
  abroad: '✈️',
  city: '🏙️',
  family: '👨‍👩‍👧',
  friends: '🎉',
};

export default function L1PurposeStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { t } = useTranslation();
  const [purpose, setPurpose] = useState<string | undefined>(answers.purpose);
  return (
    <StepShell
      step="L1_purpose"
      role={answers.role}
      kicker={t('onboarding.l1.kicker')}
      title={t('onboarding.l1.title')}
      onBack={onBack}
      onSkip={onSkip}
      footer={
        <PrimaryButton
          label={t('onboarding.continue')}
          disabled={!purpose}
          onPress={() => purpose && onAnswer({ purpose })}
        />
      }
    >
      {PURPOSE_OPTIONS.map((opt) => (
        <OptionCard
          key={opt}
          emoji={EMOJI[opt]}
          title={t(LABEL_KEY[opt])}
          selected={purpose === opt}
          onPress={() => setPurpose(opt)}
        />
      ))}
    </StepShell>
  );
}
