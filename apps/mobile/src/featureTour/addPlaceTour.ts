/**
 * Independent Add Place contextual tour (#162).
 * Separate completion flag from group feature tour; explanation-only.
 * Account completion uses per-account pending-desired + retry so a failed
 * profile write for one account cannot clear or overwrite another account's
 * pending sync on a shared device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AccountPreferences } from '../types';

export const ADD_PLACE_TOUR_STORAGE_KEY = 'hither.addPlaceTour.v1';

/**
 * Prefix for per-account pending profile sync records.
 * Full key = `${ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY}:${accountId}`.
 * Legacy unscoped key (same string without suffix) is migrated on read.
 */
export const ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY =
  'hither.addPlaceTour.accountSyncPending';

/** Local completion key scoped by account so one user cannot suppress another. */
export function addPlaceTourStorageKey(accountId?: string | null): string {
  if (accountId && accountId.length > 0) {
    return `${ADD_PLACE_TOUR_STORAGE_KEY}:${accountId}`;
  }
  return ADD_PLACE_TOUR_STORAGE_KEY;
}

/** Pending account-sync storage key for one account only. */
export function addPlaceTourAccountSyncPendingKey(accountId: string): string {
  return `${ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY}:${accountId}`;
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
  accountId: string,
  record: AddPlaceTourAccountSyncPending | null,
): Promise<void> {
  const key = addPlaceTourAccountSyncPendingKey(accountId);
  if (!record) {
    await AsyncStorage.removeItem(key);
    // Also drop legacy unscoped key if it belonged to this account.
    try {
      const legacy = parseAddPlaceTourAccountSyncPending(
        await AsyncStorage.getItem(ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY),
      );
      if (legacy?.accountId === accountId) {
        await AsyncStorage.removeItem(ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY);
      }
    } catch {
      // best-effort
    }
    return;
  }
  await AsyncStorage.setItem(key, JSON.stringify(record));
}

/**
 * Read pending account-sync for one account only.
 * Does not return another account's pending marker.
 * Migrates a matching legacy global record into the per-account key.
 */
export async function readAddPlaceTourAccountSyncPending(
  accountId: string | null | undefined,
): Promise<AddPlaceTourAccountSyncPending | null> {
  if (!accountId) return null;
  try {
    const scopedRaw = await AsyncStorage.getItem(
      addPlaceTourAccountSyncPendingKey(accountId),
    );
    const scoped = parseAddPlaceTourAccountSyncPending(scopedRaw);
    if (scoped && scoped.accountId === accountId) return scoped;

    // Migrate legacy single-key record if it matches this account.
    const legacyRaw = await AsyncStorage.getItem(
      ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY,
    );
    const legacy = parseAddPlaceTourAccountSyncPending(legacyRaw);
    if (legacy && legacy.accountId === accountId) {
      await AsyncStorage.setItem(
        addPlaceTourAccountSyncPendingKey(accountId),
        JSON.stringify(legacy),
      );
      await AsyncStorage.removeItem(ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY);
      return legacy;
    }
    return null;
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
 * per-account pending retry on failure. Never clears another account's
 * pending record on success or failure.
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
    await writeAddPlacePendingRecord(opts.accountId, null);
  } catch {
    try {
      await writeAddPlacePendingRecord(opts.accountId, {
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
 * Clears that account's pending only after the account write succeeds.
 * Never reads or clears another account's pending storage.
 */
export async function retryPendingAddPlaceTourAccountSync(opts: {
  accountId: string | null | undefined;
  existingPreferences?: AccountPreferences | null;
}): Promise<boolean> {
  const accountId = opts.accountId;
  if (!accountId) return true;
  const pending = await readAddPlaceTourAccountSyncPending(accountId);
  if (!pending) return true;
  if (pending.accountId !== accountId) return false;

  const next: AccountPreferences = {
    ...(opts.existingPreferences ?? {}),
    addPlaceTourCompleted: pending.completed,
  };
  try {
    await updatePreferencesOnAccount(next);
    await writeAddPlacePendingRecord(accountId, null);
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
