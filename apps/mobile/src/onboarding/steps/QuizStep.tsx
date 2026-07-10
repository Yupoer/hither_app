import React, { useState } from 'react';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { QuizAnswer, StepProps, StepId } from '../types';
import StepShell from './StepShell';
import OptionCard from './OptionCard';
import PrimaryButton from './PrimaryButton';

/**
 * Shared renderer for the three A/B personality-quiz steps (F1/F2/F3) — same
 * layout, different question/answer keys, so they don't need three near-
 * identical files. Selecting marks the card; Continue advances.
 */
function makeQuizStep(
  step: 'F1' | 'F2' | 'F3',
  n: number,
  titleKey: TranslationKey,
  aKey: TranslationKey,
  bKey: TranslationKey,
  emojiA: string,
  emojiB: string,
) {
  return function QuizStepImpl({ answers, onAnswer, onSkip, onBack }: StepProps) {
    const { t } = useTranslation();
    const [sel, setSel] = useState<QuizAnswer | undefined>(answers.quiz?.[step]);

    return (
      <StepShell
        step={step as StepId}
        role={answers.role}
        kicker={t('onboarding.quiz.kicker', { n })}
        title={t(titleKey)}
        onBack={onBack}
        onSkip={onSkip}
        footer={
          <PrimaryButton
            label={t('onboarding.continue')}
            disabled={!sel}
            onPress={() => sel && onAnswer({ quiz: { ...answers.quiz, [step]: sel } })}
          />
        }
      >
        <OptionCard emoji={emojiA} title={t(aKey)} selected={sel === 'A'} onPress={() => setSel('A')} />
        <OptionCard emoji={emojiB} title={t(bKey)} selected={sel === 'B'} onPress={() => setSel('B')} />
      </StepShell>
    );
  };
}

export const F1Step = makeQuizStep('F1', 1, 'onboarding.f1.title', 'onboarding.f1.a', 'onboarding.f1.b', '🍜', '🚶');
export const F2Step = makeQuizStep('F2', 2, 'onboarding.f2.title', 'onboarding.f2.a', 'onboarding.f2.b', '🗺️', '🍃');
export const F3Step = makeQuizStep('F3', 3, 'onboarding.f3.title', 'onboarding.f3.a', 'onboarding.f3.b', '⏰', '🐌');
