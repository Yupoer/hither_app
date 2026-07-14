import type { QuizAnswer } from './types';

/**
 * Pure content/data for the Onboarding flow: option lists, the quiz
 * questions, and the mascot lookup table. Copy itself lives in i18n
 * (`onboarding.*` keys) — this file only holds the ids/structure so the UI
 * (dumb components) and the state machine can be swapped without touching
 * wording.
 */

// --- L1: leader trip purpose (2x2) ------------------------------------

export const PURPOSE_OPTIONS = ['abroad', 'city', 'family', 'friends'] as const;
export type PurposeOption = (typeof PURPOSE_OPTIONS)[number];

// --- L2: trip length -----------------------------------------------------

export const MIN_DAYS = 1;
export const MAX_DAYS = 14;

// --- F1-F3: personality quiz (A/B) ----------------------------------------

export type QuizQuestionId = 'F1' | 'F2' | 'F3';

export const QUIZ_QUESTIONS: QuizQuestionId[] = ['F1', 'F2', 'F3'];

// --- Mascots ---------------------------------------------------------------

export type MascotId = 'collie' | 'retriever' | 'koala' | 'cat';

export interface Mascot {
  id: MascotId;
  nameKey: string;
  descriptionKey: string;
  bestLeaderKey: string;
}

export const MASCOTS: Record<MascotId, Mascot> = {
  collie: {
    id: 'collie',
    nameKey: 'onboarding.mascot.collie.name',
    descriptionKey: 'onboarding.mascot.collie.description',
    bestLeaderKey: 'onboarding.mascot.collie.bestLeader',
  },
  retriever: {
    id: 'retriever',
    nameKey: 'onboarding.mascot.retriever.name',
    descriptionKey: 'onboarding.mascot.retriever.description',
    bestLeaderKey: 'onboarding.mascot.retriever.bestLeader',
  },
  koala: {
    id: 'koala',
    nameKey: 'onboarding.mascot.koala.name',
    descriptionKey: 'onboarding.mascot.koala.description',
    bestLeaderKey: 'onboarding.mascot.koala.bestLeader',
  },
  cat: {
    id: 'cat',
    nameKey: 'onboarding.mascot.cat.name',
    descriptionKey: 'onboarding.mascot.cat.description',
    bestLeaderKey: 'onboarding.mascot.cat.bestLeader',
  },
};

/** All 8 (F1,F2,F3) A/B combinations mapped to a mascot. */
const MASCOT_MAP: Record<string, MascotId> = {
  AAA: 'collie',
  BAA: 'collie',
  AAB: 'retriever',
  ABB: 'retriever',
  BBA: 'koala',
  BBB: 'koala',
  ABA: 'cat',
  BAB: 'cat',
};

/** Resolve the mascot for a completed quiz. Throws if any answer is missing. */
export function resolveMascot(quiz: {
  F1?: QuizAnswer;
  F2?: QuizAnswer;
  F3?: QuizAnswer;
}): MascotId {
  const { F1, F2, F3 } = quiz;
  if (!F1 || !F2 || !F3) {
    throw new Error('resolveMascot requires all three quiz answers');
  }
  const key = `${F1}${F2}${F3}`;
  const mascot = MASCOT_MAP[key];
  if (!mascot) {
    throw new Error(`resolveMascot: no mapping for combination "${key}"`);
  }
  return mascot;
}

// --- F4: attraction preferences (multi-select) ------------------------

export const PREF_OPTIONS = [
  'food',
  'sights',
  'shopping',
  'nature',
  'culture',
  'nightlife',
] as const;
export type PrefOption = (typeof PREF_OPTIONS)[number];

// --- Browser branch: C1-C3 (single-select) ---------------------------

export const WHY_OPTIONS = ['findPeople', 'fearLost', 'planTrip', 'curious'] as const;
export type WhyOption = (typeof WHY_OPTIONS)[number];

export const COMPANION_OPTIONS = ['family', 'friends', 'partner', 'colleagues'] as const;
export type CompanionOption = (typeof COMPANION_OPTIONS)[number];

export const WANTED_OPTIONS = [
  'liveLocation',
  'meetReminders',
  'sharedItinerary',
  'tripRecap',
] as const;
export type WantedOption = (typeof WANTED_OPTIONS)[number];
