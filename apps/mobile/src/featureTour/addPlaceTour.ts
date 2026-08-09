/**
 * Independent Add Place contextual tour (#162).
 * Separate completion flag from group feature tour; explanation-only.
 * Account completion uses the same pending-desired + retry pattern as
 * group feature tour so a failed profile write cannot strand other devices.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AccountPreferences } from '../types';

export const ADD_PLACE_TOUR_STORAGE_KEY = 'hither.addPlaceTour.v1';

/** Pending account preference sync after a failed profile write (JSON record). */
export const ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY =
  'hither.addPlaceTour.accountSyncPending';

/** Local completion key scoped by account so one user cannot suppress another. */
export function addPlaceTourStorageKey(accountId?: string | null): string {
  if (accountId && accountId.length > 0) {
    return `${ADD_PLACE_TOUR_STORAGE_KEY}:${accountId}`;
  }
  return ADD_PLACE_TOUR_STORAGE_KEY;
}

export type AddPlaceTourStepId = 'star' | 'center';

export type AddPlaceTourTargetId = 'addPlaceFavoriteStar' | 'addPlaceCenter';

export interface AddPlaceTourStep {
  id: AddPlaceTourStepId;
  targetTestId: 'add-place-favorite-star' | 'add-place-center-btn';
  /** Measured highlight target (registry id). */
  target: AddPlaceTourTargetId;
  titleKey: string;
  bodyKey: string;
}

export const ADD_PLACE_TOUR_STEPS: readonly AddPlaceTourStep[] = [
  {
    id: 'star',
    targetTestId: 'add-place-favorite-star',
    target: 'addPlaceFavoriteStar',
    titleKey: 'tour.addPlace.star.title',
    bodyKey: 'tour.addPlace.star.body',
  },
  {
    id: 'center',
    targetTestId: 'add-place-center-btn',
    target: 'addPlaceCenter',
    titleKey: 'tour.addPlace.center.title',
    bodyKey: 'tour.addPlace.center.body',
  },
] as const;

/** Non-zero measured rect — hole only renders when this is true. */
export function isMeasuredTourRect(
  rect: { width: number; height: number } | null | undefined,
): boolean {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

/** Both star and center must measure before the tour may start. */
export function areAddPlaceTourTargetsReady(input: {
  starRect: { width: number; height: number } | null | undefined;
  centerRect: { width: number; height: number } | null | undefined;
}): boolean {
  return isMeasuredTourRect(input.starRect) && isMeasuredTourRect(input.centerRect);
}

export function isAddPlaceTourCompletedFromSources(input: {
  localCompleted: boolean;
  accountPreferences: AccountPreferences | null | undefined;
}): boolean {
  if (input.localCompleted) return true;
  if (input.accountPreferences?.addPlaceTourCompleted === true) return true;
  return false;
}

export async function readAddPlaceTourCompletedLocal(
  accountId?: string | null,
): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(addPlaceTourStorageKey(accountId));
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export async function writeAddPlaceTourCompletedLocal(
  completed: boolean,
  accountId?: string | null,
): Promise<void> {
  const key = addPlaceTourStorageKey(accountId);
  if (completed) {
    await AsyncStorage.setItem(key, '1');
  } else {
    await AsyncStorage.removeItem(key);
  }
}

/** Per-account desired completion waiting for a successful profile write. */
export interface AddPlaceTourAccountSyncPending {
  accountId: string;
  completed: boolean;
}

export function parseAddPlaceTourAccountSyncPending(
  raw: string | null,
): AddPlaceTourAccountSyncPending | null {
  if (!raw) return null;
  if (raw === '1' || raw === 'true') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AddPlaceTourAccountSyncPending>;
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

async function writeAddPlacePendingRecord(
  record: AddPlaceTourAccountSyncPending | null,
): Promise<void> {
  if (!record) {
    await AsyncStorage.removeItem(ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY);
    return;
  }
  await AsyncStorage.setItem(
    ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY,
    JSON.stringify(record),
  );
}

export async function readAddPlaceTourAccountSyncPending(): Promise<AddPlaceTourAccountSyncPending | null> {
  try {
    const raw = await AsyncStorage.getItem(ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY);
    return parseAddPlaceTourAccountSyncPending(raw);
  } catch {
    return null;
  }
}

async function updatePreferencesOnAccount(
  preferences: AccountPreferences,
): Promise<void> {
  const { updateProfile } = await import('../api/services/ProfileService');
  await updateProfile({ preferences });
}

/**
 * Complete tour only on final step. Local first; account sync with
 * account-scoped pending retry on failure (group-tour pattern).
 * Does not touch groupFeatureTourCompleted.
 */
export async function completeAddPlaceTour(opts: {
  accountId?: string | null;
  existingPreferences?: AccountPreferences | null;
}): Promise<void> {
  await writeAddPlaceTourCompletedLocal(true, opts.accountId);
  if (!opts.accountId) return;
  const next: AccountPreferences = {
    ...(opts.existingPreferences ?? {}),
    addPlaceTourCompleted: true,
  };
  try {
    await updatePreferencesOnAccount(next);
    await writeAddPlacePendingRecord(null);
  } catch {
    try {
      await writeAddPlacePendingRecord({
        accountId: opts.accountId,
        completed: true,
      });
    } catch {
      // Pending marker is best-effort.
    }
  }
}

/**
 * Retry a previously failed account sync for the given account only.
 * Clears pending only after the account write succeeds.
 */
export async function retryPendingAddPlaceTourAccountSync(opts: {
  accountId: string | null | undefined;
  existingPreferences?: AccountPreferences | null;
}): Promise<boolean> {
  const accountId = opts.accountId;
  if (!accountId) return true;
  const pending = await readAddPlaceTourAccountSyncPending();
  if (!pending) return true;
  if (pending.accountId !== accountId) return false;

  const next: AccountPreferences = {
    ...(opts.existingPreferences ?? {}),
    addPlaceTourCompleted: pending.completed,
  };
  try {
    await updatePreferencesOnAccount(next);
    await writeAddPlacePendingRecord(null);
    return true;
  } catch {
    return false;
  }
}

export function shouldStartAddPlaceTour(input: {
  pendingPlaceVisible: boolean;
  targetsReady: boolean;
  localCompleted: boolean;
  accountPreferences: AccountPreferences | null | undefined;
}): boolean {
  if (!input.pendingPlaceVisible || !input.targetsReady) return false;
  return !isAddPlaceTourCompletedFromSources({
    localCompleted: input.localCompleted,
    accountPreferences: input.accountPreferences,
  });
}
