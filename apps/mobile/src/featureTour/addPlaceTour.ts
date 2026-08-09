/**
 * Independent Add Place contextual tour (#162).
 * Separate completion flag from group feature tour; explanation-only.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AccountPreferences } from '../types';

export const ADD_PLACE_TOUR_STORAGE_KEY = 'hither.addPlaceTour.v1';

export type AddPlaceTourStepId = 'star' | 'center';

export interface AddPlaceTourStep {
  id: AddPlaceTourStepId;
  targetTestId: 'add-place-favorite-star' | 'add-place-center-btn';
  titleKey: string;
  bodyKey: string;
}

export const ADD_PLACE_TOUR_STEPS: readonly AddPlaceTourStep[] = [
  {
    id: 'star',
    targetTestId: 'add-place-favorite-star',
    titleKey: 'tour.addPlace.star.title',
    bodyKey: 'tour.addPlace.star.body',
  },
  {
    id: 'center',
    targetTestId: 'add-place-center-btn',
    titleKey: 'tour.addPlace.center.title',
    bodyKey: 'tour.addPlace.center.body',
  },
] as const;

export function isAddPlaceTourCompletedFromSources(input: {
  localCompleted: boolean;
  accountPreferences: AccountPreferences | null | undefined;
}): boolean {
  if (input.localCompleted) return true;
  if (input.accountPreferences?.addPlaceTourCompleted === true) return true;
  return false;
}

export async function readAddPlaceTourCompletedLocal(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(ADD_PLACE_TOUR_STORAGE_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export async function writeAddPlaceTourCompletedLocal(
  completed: boolean,
): Promise<void> {
  if (completed) {
    await AsyncStorage.setItem(ADD_PLACE_TOUR_STORAGE_KEY, '1');
  } else {
    await AsyncStorage.removeItem(ADD_PLACE_TOUR_STORAGE_KEY);
  }
}

/**
 * Complete tour only on final step. Local first; account sync best-effort.
 * Does not touch groupFeatureTourCompleted.
 */
export async function completeAddPlaceTour(opts: {
  accountId?: string | null;
  existingPreferences?: AccountPreferences | null;
}): Promise<void> {
  await writeAddPlaceTourCompletedLocal(true);
  if (!opts.accountId) return;
  try {
    const { updateProfile } = await import('../api/services/ProfileService');
    await updateProfile({
      preferences: {
        ...(opts.existingPreferences ?? {}),
        addPlaceTourCompleted: true,
      },
    });
  } catch {
    // Local flag already set; account sync can retry later.
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
