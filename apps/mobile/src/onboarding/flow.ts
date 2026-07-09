import type { OnboardingAnswers, StepId } from './types';

/**
 * Pure step-sequencing for Onboarding. No React, no side effects — just
 * "given where we are and what's been answered, what's next/previous".
 *
 * Branches:
 *   intro -> theme -> role
 *   role=leader   -> L1_purpose -> L2_days -> L3_departure -> done
 *   role=follower -> F1 -> F2 -> F3 -> mascot -> F4_prefs -> done
 *   role=browser  -> C1_why -> C2_companions -> C3_wanted -> done
 */

export function nextStep(current: StepId, answers: OnboardingAnswers): StepId | 'done' {
  switch (current) {
    case 'intro':
      return 'theme';
    case 'theme':
      return 'role';
    case 'role':
      switch (answers.role) {
        case 'leader':
          return 'L1_purpose';
        case 'follower':
          return 'F1';
        case 'browser':
          return 'C1_why';
        default:
          return 'role';
      }
    // Leader branch
    case 'L1_purpose':
      return 'L2_days';
    case 'L2_days':
      return 'L3_departure';
    case 'L3_departure':
      return 'done';
    // Follower branch
    case 'F1':
      return 'F2';
    case 'F2':
      return 'F3';
    case 'F3':
      return 'mascot';
    case 'mascot':
      return 'F4_prefs';
    case 'F4_prefs':
      return 'done';
    // Browser branch
    case 'C1_why':
      return 'C2_companions';
    case 'C2_companions':
      return 'C3_wanted';
    case 'C3_wanted':
      return 'done';
    default:
      return 'done';
  }
}

export function prevStep(current: StepId, answers: OnboardingAnswers): StepId {
  switch (current) {
    case 'theme':
      return 'intro';
    case 'role':
      return 'theme';
    // Leader branch
    case 'L1_purpose':
      return 'role';
    case 'L2_days':
      return 'L1_purpose';
    case 'L3_departure':
      return 'L2_days';
    // Follower branch
    case 'F1':
      return 'role';
    case 'F2':
      return 'F1';
    case 'F3':
      return 'F2';
    // mascot is a computed result screen, not re-answerable — back skips
    // straight past it to F3.
    case 'mascot':
      return 'F3';
    case 'F4_prefs':
      return 'mascot';
    // Browser branch
    case 'C1_why':
      return 'role';
    case 'C2_companions':
      return 'C1_why';
    case 'C3_wanted':
      return 'C2_companions';
    case 'intro':
    default:
      return 'intro';
  }
}
