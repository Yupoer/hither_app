import React, { useState } from 'react';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { StepProps, StepId } from '../types';
import StepShell from './StepShell';
import OptionCard from './OptionCard';
import PrimaryButton from './PrimaryButton';

/**
 * Shared renderer for the browser branch's three single-select steps
 * (C1_why / C2_companions / C3_wanted) — same list-of-options layout, only
 * the kicker, question, options, emoji, and which answer field they write
 * differ. Selecting marks the card; the Continue button advances.
 */
function makeBrowserStep<K extends 'why' | 'companions' | 'wanted'>(
  step: StepId,
  field: K,
  kickerKey: TranslationKey,
  titleKey: TranslationKey,
  options: readonly string[],
  labelKeys: Record<string, TranslationKey>,
  emojis: Record<string, string>,
) {
  return function BrowserStepImpl({ answers, onAnswer, onSkip, onBack }: StepProps) {
    const { t } = useTranslation();
    const [sel, setSel] = useState<string | undefined>(answers[field] as string | undefined);
    return (
      <StepShell
        step={step}
        role={answers.role}
        kicker={t(kickerKey)}
        title={t(titleKey)}
        onBack={onBack}
        onSkip={onSkip}
        footer={
          <PrimaryButton
            label={t('onboarding.continue')}
            disabled={!sel}
            onPress={() => sel && onAnswer({ [field]: sel } as Partial<typeof answers>)}
          />
        }
      >
        {options.map((opt) => (
          <OptionCard
            key={opt}
            emoji={emojis[opt]}
            title={t(labelKeys[opt])}
            selected={sel === opt}
            onPress={() => setSel(opt)}
          />
        ))}
      </StepShell>
    );
  };
}

export default makeBrowserStep;
