import { nextStep, prevStep } from '../onboarding/flow';
import type { OnboardingAnswers, StepId } from '../onboarding/types';

function walkForward(steps: StepId[], answers: OnboardingAnswers) {
  let current: StepId = steps[0];
  const visited: StepId[] = [current];
  for (let i = 1; i < steps.length; i++) {
    const next = nextStep(current, answers);
    expect(next).toBe(steps[i]);
    current = steps[i];
    visited.push(current);
  }
  expect(nextStep(current, answers)).toBe('done');
  return visited;
}

describe('onboarding flow', () => {
  it('leader branch: intro -> theme -> role -> L1 -> L2 -> L3 -> celebration -> done', () => {
    const answers: OnboardingAnswers = { role: 'leader' };
    const steps: StepId[] = [
      'intro',
      'theme',
      'role',
      'L1_purpose',
      'L2_days',
      'L3_departure',
      'celebration',
    ];
    walkForward(steps, answers);

    // prev walk back
    expect(prevStep('L3_departure', answers)).toBe('L2_days');
    expect(prevStep('L2_days', answers)).toBe('L1_purpose');
    expect(prevStep('L1_purpose', answers)).toBe('role');
    expect(prevStep('role', answers)).toBe('theme');
    expect(prevStep('theme', answers)).toBe('intro');
  });

  it('follower branch: intro -> theme -> role -> F1 -> F2 -> F3 -> mascot -> F4 -> celebration -> done', () => {
    const answers: OnboardingAnswers = { role: 'follower' };
    const steps: StepId[] = [
      'intro',
      'theme',
      'role',
      'F1',
      'F2',
      'F3',
      'mascot',
      'F4_prefs',
      'celebration',
    ];
    walkForward(steps, answers);

    expect(prevStep('F4_prefs', answers)).toBe('mascot');
    // Back from mascot skips straight to F3, not re-triggering the mascot calc.
    expect(prevStep('mascot', answers)).toBe('F3');
    expect(prevStep('F3', answers)).toBe('F2');
    expect(prevStep('F2', answers)).toBe('F1');
    expect(prevStep('F1', answers)).toBe('role');
  });

  it('browser branch: intro -> theme -> role -> C1 -> C2 -> C3 -> celebration -> done', () => {
    const answers: OnboardingAnswers = { role: 'browser' };
    const steps: StepId[] = [
      'intro',
      'theme',
      'role',
      'C1_why',
      'C2_companions',
      'C3_wanted',
      'celebration',
    ];
    walkForward(steps, answers);

    expect(prevStep('C3_wanted', answers)).toBe('C2_companions');
    expect(prevStep('C2_companions', answers)).toBe('C1_why');
    expect(prevStep('C1_why', answers)).toBe('role');
  });

  it('role step with no role chosen yet stays put', () => {
    expect(nextStep('role', {})).toBe('role');
  });
});
