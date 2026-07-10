import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveOnboardingProfile } from '../api/client';
import type { OnboardingAnswers } from './types';

/**
 * Local persistence for the onboarding flag/answers, plus a one-shot sync of
 * the answers to the user's Supabase profile once a session exists (the
 * onboarding flow itself runs before sign-in, so it can only write locally).
 */

export const ONBOARDING_STORAGE_KEY = 'hither.onboarding.v1';

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
