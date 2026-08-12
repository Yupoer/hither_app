import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AccountPreferences } from '../types';
import { GROUP_FEATURE_TOUR_STORAGE_KEY } from './constants';

/** Pending account preference sync after a failed profile write (JSON record). */
export const GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY =
  'hither.groupFeatureTour.accountSyncPending';

/**
 * Set while a prefs reset intentionally cleared the tour flag.
 * Blocks reevaluate from re-hydrating local=true from stale in-memory
 * `accountPreferences.groupFeatureTourCompleted === true` until session
 * prefs catch up (false) or the user completes the tour again.
 */
export const GROUP_FEATURE_TOUR_RESET_INTENT_KEY =
  'hither.groupFeatureTour.resetIntent';

/** Per-account desired tour completion waiting for a successful profile write. */
export interface TourAccountSyncPending {
  accountId: string;
  completed: boolean;
}

/** Lazy profile write so node Jest pure suites never load supabase. */
async function updatePreferencesOnAccount(
  preferences: AccountPreferences,
): Promise<void> {
  const { updateProfile } = await import('../api/services/ProfileService');
  await updateProfile({ preferences });
}

export function parseTourAccountSyncPending(raw: string | null): TourAccountSyncPending | null {
  if (!raw) return null;
  // Legacy boolean marker from earlier REVIEW_FIX — not account-scoped; discard.
  if (raw === '1' || raw === 'true') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TourAccountSyncPending>;
    if (
      typeof parsed.accountId === 'string'
      && parsed.accountId.length > 0
      && typeof parsed.completed === 'boolean'
    ) {
      return { accountId: parsed.accountId, completed: parsed.completed };
    }
  } catch {
    // ignore
  }
  return null;
}

async function writePendingRecord(record: TourAccountSyncPending | null): Promise<void> {
  if (!record) {
    await AsyncStorage.removeItem(GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY);
    return;
  }
  await AsyncStorage.setItem(
    GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY,
    JSON.stringify(record),
  );
}

export async function readTourAccountSyncPending(): Promise<TourAccountSyncPending | null> {
  try {
    const raw = await AsyncStorage.getItem(GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY);
    return parseTourAccountSyncPending(raw);
  } catch {
    return null;
  }
}

/** @deprecated Prefer readTourAccountSyncPending; kept for test compatibility. */
export async function isTourAccountSyncPending(): Promise<boolean> {
  return (await readTourAccountSyncPending()) != null;
}

export async function readTourResetIntent(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(GROUP_FEATURE_TOUR_RESET_INTENT_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export async function writeTourResetIntent(active: boolean): Promise<void> {
  if (active) {
    await AsyncStorage.setItem(GROUP_FEATURE_TOUR_RESET_INTENT_KEY, '1');
  } else {
    await AsyncStorage.removeItem(GROUP_FEATURE_TOUR_RESET_INTENT_KEY);
  }
}

/**
 * Best-effort account write; records a per-account pending record on failure.
 * Does not throw (caller has already succeeded locally when completing).
 */
async function bestEffortUpdatePreferences(
  preferences: AccountPreferences,
  accountId: string | null | undefined,
  completed: boolean,
): Promise<void> {
  try {
    await updatePreferencesOnAccount(preferences);
    await writePendingRecord(null);
  } catch {
    if (!accountId) return;
    try {
      await writePendingRecord({ accountId, completed });
    } catch {
      // Local pending marker is best-effort.
    }
  }
}

/**
 * Retry a previously failed account sync for the given account only.
 * Uses the stored desired `completed` value (completion and reset both retry correctly).
 * Returns true when remote write succeeds or nothing is pending for this account.
 */
export async function retryPendingTourAccountSync(opts: {
  accountId: string | null | undefined;
  existingPreferences?: AccountPreferences | null;
}): Promise<boolean> {
  const accountId = opts.accountId;
  if (!accountId) return true;
  const pending = await readTourAccountSyncPending();
  if (!pending) return true;
  // Different account: do not apply or clear — leave for the correct session.
  if (pending.accountId !== accountId) return false;

  const next: AccountPreferences = {
    ...(opts.existingPreferences ?? {}),
    groupFeatureTourCompleted: pending.completed,
  };
  try {
    await updatePreferencesOnAccount(next);
    await writePendingRecord(null);
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
 * Account sync is best-effort with per-account pending retry on failure.
 */
export async function completeGroupFeatureTour(opts?: {
  accountId?: string | null;
  existingPreferences?: AccountPreferences | null;
}): Promise<void> {
  await writeTourResetIntent(false);
  await writeGroupFeatureTourCompletedLocal(true);
  const next: AccountPreferences = {
    ...(opts?.existingPreferences ?? {}),
    groupFeatureTourCompleted: true,
  };
  await bestEffortUpdatePreferences(next, opts?.accountId, true);
}

/**
 * Clear tour completion (reset prefs). Local + best-effort account with pending false.
 * Sets reset intent so reevaluate cannot undo local false from stale memory prefs.
 */
export async function clearGroupFeatureTour(opts?: {
  accountId?: string | null;
  existingPreferences?: AccountPreferences | null;
}): Promise<void> {
  await writeGroupFeatureTourCompletedLocal(false);
  await writeTourResetIntent(true);
  const next: AccountPreferences = {
    ...(opts?.existingPreferences ?? {}),
    groupFeatureTourCompleted: false,
  };
  await bestEffortUpdatePreferences(next, opts?.accountId, false);
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
 *
 * #171: requires durable onboarding completion (not a pending onboarding
 * replay). Empty groups wait for the first real destination — never invents
 * demo cards. Tour completion is a separate owner from onboarding.
 */
export function shouldStartGroupFeatureTour(input: {
  onboardingCompleted: boolean;
  hasGroupId: boolean;
  destinationCount: number;
  tourCompleted: boolean;
  /** Passive companion mode blocks dense chrome tour. */
  passiveMode?: boolean;
  /** When prefs reset marked onboarding for home replay, block tour. */
  onboardingReplayPending?: boolean;
}): boolean {
  if (input.onboardingReplayPending) return false;
  if (!input.onboardingCompleted) return false;
  if (!input.hasGroupId) return false;
  if (input.destinationCount < 1) return false;
  if (input.tourCompleted) return false;
  if (input.passiveMode) return false;
  return true;
}
