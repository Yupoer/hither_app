import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveOnboardingProfile } from '../api/client';
import type { OnboardingAnswers } from './types';

/**
 * Local persistence for the onboarding flag/answers, plus a one-shot sync of
 * the answers to the user's Supabase profile once a session exists (the
 * onboarding flow itself runs before sign-in, so it can only write locally).
 *
 * #171: full onboarding completion is owned here; group feature tour has its
 * own flags under featureTour/storage. Reset marks a durable replay intent and
 * must not force navigation — App only presents onboarding at the create/join
 * home boundary (no active membership).
 */

export const ONBOARDING_STORAGE_KEY = 'hither.onboarding.v1';

/**
 * Set by "reset travel preferences". Survives remount until the create/join
 * home boundary consumes it and starts full onboarding.
 */
export const ONBOARDING_REPLAY_INTENT_KEY = 'hither.onboarding.replayIntent';

interface StoredOnboarding {
  completed: boolean;
  answers: OnboardingAnswers;
  completedAt: string;
  /** Set once `saveOnboardingProfile` has succeeded, so we sync at most once. */
  synced?: boolean;
}

export async function readOnboardingState(): Promise<StoredOnboarding | null> {
  const raw = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredOnboarding;
  } catch {
    return null;
  }
}

export async function writeOnboardingCompleted(answers: OnboardingAnswers): Promise<void> {
  const state: StoredOnboarding = {
    completed: true,
    answers,
    completedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  // Completing full onboarding clears any pending replay intent.
  await writeOnboardingReplayIntent(false);
}

export async function readOnboardingReplayIntent(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(ONBOARDING_REPLAY_INTENT_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export async function writeOnboardingReplayIntent(active: boolean): Promise<void> {
  if (active) {
    await AsyncStorage.setItem(ONBOARDING_REPLAY_INTENT_KEY, '1');
  } else {
    await AsyncStorage.removeItem(ONBOARDING_REPLAY_INTENT_KEY);
  }
}

/**
 * Prefs reset: mark onboarding for replay at home, clear local answers so the
 * next home presentation runs the full survey. Does not navigate.
 */
export async function markOnboardingReplayForHome(): Promise<void> {
  await writeOnboardingReplayIntent(true);
  await AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY);
}

/**
 * Pure gate: when may the App shell present full OnboardingScreen?
 *
 * - First launch / incomplete: always (even before session).
 * - After reset: only at create/join home (no active group membership).
 * - Still inside a team after reset: false (stay on Map / settings).
 */
export function shouldPresentFullOnboarding(input: {
  storageCompleted: boolean;
  replayIntent: boolean;
  /** True when user is on create/join home (no membership) or signed out. */
  atHomeBoundary: boolean;
}): boolean {
  if (!input.storageCompleted) {
    // Incomplete storage: first launch always; after mid-session clear only at home.
    if (input.replayIntent) return input.atHomeBoundary;
    return true;
  }
  // Storage still says completed — only force replay when intent is set at home.
  if (input.replayIntent && input.atHomeBoundary) return true;
  return false;
}

/**
 * Whether group tour may treat onboarding as done.
 * Replay-pending must block tour until full onboarding is finished again.
 */
export function isOnboardingCompleteForTourGate(input: {
  storageCompleted: boolean;
  replayIntent: boolean;
}): boolean {
  if (input.replayIntent) return false;
  return input.storageCompleted;
}

/**
 * Called once a session exists (SessionContext, on sign-in success). If the
 * device has completed onboarding but hasn't synced the answers to the
 * profile yet, push them now and mark it synced. Never throws — a failed
 * sync (e.g. the `onboarding` column not deployed yet) must not break login.
 */
export async function syncOnboardingIfNeeded(): Promise<void> {
  const state = await readOnboardingState();
  if (!state?.completed || state.synced) return;
  try {
    await saveOnboardingProfile(state.answers);
    await AsyncStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({ ...state, synced: true }),
    );
  } catch (e) {
    console.warn('[onboarding] profile sync failed', e);
  }
}
