import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AccountPreferences } from '../types';
import { GROUP_FEATURE_TOUR_STORAGE_KEY } from './constants';

/** Pending account preference sync after a failed profile write. */
export const GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY =
  'hither.groupFeatureTour.accountSyncPending';

/** Lazy profile write so node Jest pure suites never load supabase. */
async function updatePreferencesOnAccount(
  preferences: AccountPreferences,
): Promise<void> {
  const { updateProfile } = await import('../api/services/ProfileService');
  await updateProfile({ preferences });
}

async function markAccountSyncPending(pending: boolean): Promise<void> {
  if (pending) {
    await AsyncStorage.setItem(GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY, '1');
  } else {
    await AsyncStorage.removeItem(GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY);
  }
}

export async function isTourAccountSyncPending(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

/**
 * Best-effort account write; records a pending flag on failure for later retry.
 * Does not throw (caller has already succeeded locally when completing).
 */
async function bestEffortUpdatePreferences(
  preferences: AccountPreferences,
): Promise<void> {
  try {
    await updatePreferencesOnAccount(preferences);
    await markAccountSyncPending(false);
  } catch {
    try {
      await markAccountSyncPending(true);
    } catch {
      // Local pending marker is best-effort.
    }
  }
}

/**
 * Retry a previously failed account sync (e.g. fresh launch / reevaluate).
 * Returns true when the remote write succeeds or nothing was pending.
 */
export async function retryPendingTourAccountSync(opts?: {
  existingPreferences?: AccountPreferences | null;
  completed: boolean;
}): Promise<boolean> {
  const pending = await isTourAccountSyncPending();
  if (!pending) return true;
  const next: AccountPreferences = {
    ...(opts?.existingPreferences ?? {}),
    groupFeatureTourCompleted: opts?.completed ?? true,
  };
  try {
    await updatePreferencesOnAccount(next);
    await markAccountSyncPending(false);
    return true;
  } catch {
    return false;
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
 * Complete the tour: local flag must succeed (throws on local failure).
 * Account sync is best-effort with pending retry on failure.
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
