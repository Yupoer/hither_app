import React, { useCallback, useState } from 'react';
import type { ComponentType } from 'react';
import { nextStep, prevStep } from './flow';
import { writeOnboardingCompleted } from './sync';
import type { OnboardingAnswers, StepId, StepProps } from './types';
import { selectionTick } from '../utils/haptics';

import IntroStep from './steps/IntroStep';
import ThemeStep from './steps/ThemeStep';
import RoleStep from './steps/RoleStep';
import L1PurposeStep from './steps/L1PurposeStep';
import L2DaysStep from './steps/L2DaysStep';
import L3DepartureStep from './steps/L3DepartureStep';
import { F1Step, F2Step, F3Step } from './steps/QuizStep';
import MascotStep from './steps/MascotStep';
import F4PrefsStep from './steps/F4PrefsStep';
import C1WhyStep from './steps/C1WhyStep';
import C2CompanionsStep from './steps/C2CompanionsStep';
import C3WantedStep from './steps/C3WantedStep';

/**
 * step id -> component. This is the whole UI surface: to reskin Onboarding,
 * swap the components imported above (and the files under steps/) without
 * touching flow.ts / content.ts / this container's state logic.
 */
const STEP_RENDERERS: Record<StepId, ComponentType<StepProps>> = {
  intro: IntroStep,
  theme: ThemeStep,
  role: RoleStep,
  L1_purpose: L1PurposeStep,
  L2_days: L2DaysStep,
  L3_departure: L3DepartureStep,
  F1: F1Step,
  F2: F2Step,
  F3: F3Step,
  mascot: MascotStep,
  F4_prefs: F4PrefsStep,
  C1_why: C1WhyStep,
  C2_companions: C2CompanionsStep,
  C3_wanted: C3WantedStep,
};

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<StepId>('intro');
  const [answers, setAnswers] = useState<OnboardingAnswers>({});

  const finish = useCallback((finalAnswers: OnboardingAnswers) => {
    void writeOnboardingCompleted(finalAnswers);
    onDone();
  }, [onDone]);

  const handleAnswer = useCallback(
    (patch: Partial<OnboardingAnswers>) => {
      const merged = { ...answers, ...patch };
      setAnswers(merged);
      const next = nextStep(step, merged);
      if (next === 'done') {
        finish(merged);
        return;
      }
      selectionTick();
      setStep(next);
    },
    [answers, step, finish],
  );

  const handleBack = useCallback(() => {
    setStep((s) => prevStep(s, answers));
  }, [answers]);

  const handleSkip = useCallback(() => {
    finish(answers);
  }, [answers, finish]);

  const Step = STEP_RENDERERS[step];
  return (
    <Step answers={answers} onAnswer={handleAnswer} onSkip={handleSkip} onBack={handleBack} />
  );
}
