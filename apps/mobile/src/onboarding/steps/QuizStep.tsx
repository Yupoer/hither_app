import React from 'react';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { QuizAnswer, StepProps, StepId } from '../types';
import StepShell from './StepShell';
import OptionCard from './OptionCard';

/**
 * Shared renderer for the three A/B personality-quiz steps (F1/F2/F3) — same
 * layout, different question/answer keys, so they don't need three near-
 * identical files.
 */
function makeQuizStep(step: 'F1' | 'F2' | 'F3', titleKey: TranslationKey, aKey: TranslationKey, bKey: TranslationKey) {
  return function QuizStepImpl({ answers, onAnswer, onSkip, onBack }: StepProps) {
    const { t } = useTranslation();
    const current = answers.quiz?.[step];

    const answer = (value: QuizAnswer) => {
      onAnswer({ quiz: { ...answers.quiz, [step]: value } });
    };

    return (
      <StepShell
        step={step as StepId}
        role={answers.role}
        title={t(titleKey)}
        onBack={onBack}
        onSkip={onSkip}
      >
        <OptionCard title={t(aKey)} selected={current === 'A'} onPress={() => answer('A')} />
        <OptionCard title={t(bKey)} selected={current === 'B'} onPress={() => answer('B')} />
      </StepShell>
    );
  };
}

export const F1Step = makeQuizStep('F1', 'onboarding.f1.title', 'onboarding.f1.a', 'onboarding.f1.b');
export const F2Step = makeQuizStep('F2', 'onboarding.f2.title', 'onboarding.f2.a', 'onboarding.f2.b');
export const F3Step = makeQuizStep('F3', 'onboarding.f3.title', 'onboarding.f3.a', 'onboarding.f3.b');
