import React from 'react';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { StepProps, StepId } from '../types';
import StepShell from './StepShell';
import OptionCard from './OptionCard';

/**
 * Shared renderer for the browser branch's three single-select steps
 * (C1_why / C2_companions / C3_wanted) — same list-of-options layout, only
 * the question, options, and which answer field they write differ.
 */
function makeBrowserStep<K extends 'why' | 'companions' | 'wanted'>(
  step: StepId,
  field: K,
  titleKey: TranslationKey,
  options: readonly string[],
  labelKeys: Record<string, TranslationKey>,
) {
  return function BrowserStepImpl({ answers, onAnswer, onSkip, onBack }: StepProps) {
    const { t } = useTranslation();
    const current = answers[field];
    return (
      <StepShell
        step={step}
        role={answers.role}
        title={t(titleKey)}
        onBack={onBack}
        onSkip={onSkip}
      >
        {options.map((opt) => (
          <OptionCard
            key={opt}
            title={t(labelKeys[opt])}
            selected={current === opt}
            onPress={() => onAnswer({ [field]: opt } as Partial<typeof answers>)}
          />
        ))}
      </StepShell>
    );
  };
}

export default makeBrowserStep;
