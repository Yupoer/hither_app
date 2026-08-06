import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AccountPreferences } from '../types';
import { GROUP_FEATURE_TOUR_STORAGE_KEY } from './constants';

/** Lazy profile write so node Jest pure suites never load supabase. */
async function bestEffortUpdatePreferences(preferences: AccountPreferences): Promise<void> {
  try {
    const { updateProfile } = await import('../api/services/ProfileService');
    await updateProfile({ preferences });
  } catch {
    // Best-effort; local flag already written.
  }
}

export async function readGroupFeatureTourCompletedLocal(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(GROUP_FEATURE_TOUR_STORAGE_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export async function writeGroupFeatureTourCompletedLocal(completed: boolean): Promise<void> {
  if (completed) {
    await AsyncStorage.setItem(GROUP_FEATURE_TOUR_STORAGE_KEY, '1');
  } else {
    await AsyncStorage.removeItem(GROUP_FEATURE_TOUR_STORAGE_KEY);
  }
}

/**
 * Complete the tour: local first (unblocks UI), then best-effort account sync.
 * Account failure must not throw to the UI caller after local write succeeds.
 */
export async function completeGroupFeatureTour(opts?: {
  existingPreferences?: AccountPreferences | null;
}): Promise<void> {
  await writeGroupFeatureTourCompletedLocal(true);
  const next: AccountPreferences = {
    ...(opts?.existingPreferences ?? {}),
    groupFeatureTourCompleted: true,
  };
  await bestEffortUpdatePreferences(next);
}

/**
 * Clear tour completion (reset prefs). Local + best-effort account.
 */
export async function clearGroupFeatureTour(opts?: {
  existingPreferences?: AccountPreferences | null;
}): Promise<void> {
  await writeGroupFeatureTourCompletedLocal(false);
  const next: AccountPreferences = {
    ...(opts?.existingPreferences ?? {}),
    groupFeatureTourCompleted: false,
  };
  await bestEffortUpdatePreferences(next);
}

/** Whether tour should be considered done from local or account preference. */
export function isTourCompletedFromSources(input: {
  localCompleted: boolean;
  accountCompleted?: boolean | null;
}): boolean {
  if (input.localCompleted) return true;
  if (input.accountCompleted === true) return true;
  return false;
}

/**
 * Pure gate: should the group feature tour activate?
 * Tests drive this without MapScreen.
 */
export function shouldStartGroupFeatureTour(input: {
  onboardingCompleted: boolean;
  hasGroupId: boolean;
  destinationCount: number;
  tourCompleted: boolean;
  /** Passive companion mode blocks dense chrome tour. */
  passiveMode?: boolean;
}): boolean {
  if (!input.onboardingCompleted) return false;
  if (!input.hasGroupId) return false;
  if (input.destinationCount < 1) return false;
  if (input.tourCompleted) return false;
  if (input.passiveMode) return false;
  return true;
}
