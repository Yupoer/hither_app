/**
 * Pure types for the Onboarding flow. No React imports here — the flow state
 * machine (flow.ts) and content (content.ts) are plain data/functions so the
 * UI (steps/*.tsx) can be swapped wholesale without touching the logic.
 */

export type OnboardingRole = 'leader' | 'follower' | 'browser';

export type StepId =
  | 'intro'
  | 'theme'
  | 'role' // shared
  | 'L1_purpose'
  | 'L2_days'
  | 'L3_departure' // leader
  | 'F1'
  | 'F2'
  | 'F3'
  | 'mascot'
  | 'F4_prefs' // follower
  | 'C1_why'
  | 'C2_companions'
  | 'C3_wanted' // browser
  | 'celebration'; // shared finish/congrats screen (all branches end here)

/** A/B answer to one of the F1-F3 personality quiz questions. */
export type QuizAnswer = 'A' | 'B';

export interface OnboardingAnswers {
  role?: OnboardingRole;
  theme?: string;

  // Leader branch
  purpose?: string;
  days?: number;
  /** ISO date string, or null for "I need this right now". */
  departureDate?: string | null;

  // Follower branch
  quiz?: { F1?: QuizAnswer; F2?: QuizAnswer; F3?: QuizAnswer };
  mascot?: string;
  prefs?: string[];

  // Browser branch
  why?: string;
  companions?: string;
  wanted?: string;
}

export interface StepProps {
  answers: OnboardingAnswers;
  /** Merge `patch` into the answers and advance to the next step. */
  onAnswer(patch: Partial<OnboardingAnswers>): void;
  /** Skip the entire onboarding flow. */
  onSkip(): void;
  onBack(): void;
}
