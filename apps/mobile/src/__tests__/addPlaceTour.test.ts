import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY,
  ADD_PLACE_TOUR_STEPS,
  addPlaceTourAccountSyncPendingKey,
  addPlaceTourStorageKey,
  areAddPlaceTourTargetsReady,
  clearAddPlaceTour,
  completeAddPlaceTour,
  isAddPlaceTourCompletedFromSources,
  readAddPlaceTourCompletedLocal,
  isMeasuredTourRect,
  parseAddPlaceTourAccountSyncPending,
  readAddPlaceTourAccountSyncPending,
  retryPendingAddPlaceTourAccountSync,
  shouldStartAddPlaceTour,
} from '../featureTour/addPlaceTour';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const updateProfile = jest.fn();
jest.mock('../api/services/ProfileService', () => ({
  updateProfile: (...args: unknown[]) => updateProfile(...args),
}));

describe('Add Place tour (#162)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    updateProfile.mockResolvedValue(undefined);
  });

  it('has star then center steps with real target test ids and registry targets', () => {
    expect(ADD_PLACE_TOUR_STEPS.map((s) => s.id)).toEqual(['star', 'center']);
    expect(ADD_PLACE_TOUR_STEPS[0].targetTestId).toBe('add-place-favorite-star');
    expect(ADD_PLACE_TOUR_STEPS[1].targetTestId).toBe('add-place-center-btn');
    expect(ADD_PLACE_TOUR_STEPS[0].target).toBe('addPlaceFavoriteStar');
    expect(ADD_PLACE_TOUR_STEPS[1].target).toBe('addPlaceCenter');
  });

  it('clearAddPlaceTour resets local and account so the tour can start again', async () => {
    await completeAddPlaceTour({
      accountId: 'user-a',
      existingPreferences: { addPlaceTourCompleted: true },
    });
    expect(await readAddPlaceTourCompletedLocal('user-a')).toBe(true);
    updateProfile.mockClear();
    await clearAddPlaceTour({
      accountId: 'user-a',
      existingPreferences: { addPlaceTourCompleted: true },
    });
    expect(await readAddPlaceTourCompletedLocal('user-a')).toBe(false);
    expect(updateProfile).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ addPlaceTourCompleted: false }),
    });
    expect(
      shouldStartAddPlaceTour({
        pendingPlaceVisible: true,
        targetsReady: true,
        localCompleted: false,
        accountPreferences: { addPlaceTourCompleted: false },
      }),
    ).toBe(true);
  });

  it('does not share group tour completion flag', () => {
    expect(
      isAddPlaceTourCompletedFromSources({
        localCompleted: false,
        accountPreferences: { groupFeatureTourCompleted: true },
      }),
    ).toBe(false);
    expect(
      isAddPlaceTourCompletedFromSources({
        localCompleted: false,
        accountPreferences: { addPlaceTourCompleted: true },
      }),
    ).toBe(true);
  });

  it('starts only when pending place + targets ready and not completed', () => {
    expect(
      shouldStartAddPlaceTour({
        pendingPlaceVisible: true,
        targetsReady: true,
        localCompleted: false,
        accountPreferences: null,
      }),
    ).toBe(true);
    expect(
      shouldStartAddPlaceTour({
        pendingPlaceVisible: true,
        targetsReady: false,
        localCompleted: false,
        accountPreferences: null,
      }),
    ).toBe(false);
    expect(
      shouldStartAddPlaceTour({
        pendingPlaceVisible: true,
        targetsReady: true,
        localCompleted: true,
        accountPreferences: null,
      }),
    ).toBe(false);
  });

  it('scopes local completion key by account', () => {
    expect(addPlaceTourStorageKey('user-a')).toBe('hither.addPlaceTour.v1:user-a');
    expect(addPlaceTourStorageKey('user-b')).toBe('hither.addPlaceTour.v1:user-b');
    expect(addPlaceTourStorageKey('user-a')).not.toBe(addPlaceTourStorageKey('user-b'));
    expect(addPlaceTourStorageKey(null)).toBe('hither.addPlaceTour.v1');
  });

  it('scopes pending account-sync key by account', () => {
    expect(addPlaceTourAccountSyncPendingKey('user-a')).toBe(
      'hither.addPlaceTour.accountSyncPending:user-a',
    );
    expect(addPlaceTourAccountSyncPendingKey('user-b')).toBe(
      'hither.addPlaceTour.accountSyncPending:user-b',
    );
    expect(addPlaceTourAccountSyncPendingKey('user-a')).not.toBe(
      addPlaceTourAccountSyncPendingKey('user-b'),
    );
  });

  it('requires both star and center non-zero rects before start', () => {
    expect(
      areAddPlaceTourTargetsReady({
        starRect: { width: 40, height: 40 },
        centerRect: { width: 80, height: 48 },
      }),
    ).toBe(true);
    expect(
      areAddPlaceTourTargetsReady({
        starRect: { width: 40, height: 40 },
        centerRect: null,
      }),
    ).toBe(false);
    expect(
      areAddPlaceTourTargetsReady({
        starRect: { width: 0, height: 0 },
        centerRect: { width: 80, height: 48 },
      }),
    ).toBe(false);
    expect(isMeasuredTourRect(null)).toBe(false);
    expect(isMeasuredTourRect({ width: 0, height: 10 })).toBe(false);
    expect(isMeasuredTourRect({ width: 10, height: 10 })).toBe(true);
  });

  it('stores per-account pending on failed complete and retries only that account', async () => {
    updateProfile.mockRejectedValueOnce(new Error('network'));
    await completeAddPlaceTour({
      accountId: 'user-a',
      existingPreferences: {},
    });
    expect(await readAddPlaceTourAccountSyncPending('user-a')).toEqual({
      accountId: 'user-a',
      completed: true,
    });
    expect(await readAddPlaceTourAccountSyncPending('user-b')).toBeNull();

    updateProfile.mockResolvedValueOnce(undefined);
    await expect(
      retryPendingAddPlaceTourAccountSync({
        accountId: 'user-a',
        existingPreferences: {},
      }),
    ).resolves.toBe(true);
    expect(updateProfile).toHaveBeenLastCalledWith({
      preferences: expect.objectContaining({ addPlaceTourCompleted: true }),
    });
    expect(await readAddPlaceTourAccountSyncPending('user-a')).toBeNull();
  });

  it('does not apply another account pending marker', async () => {
    await AsyncStorage.setItem(
      addPlaceTourAccountSyncPendingKey('user-a'),
      JSON.stringify({ accountId: 'user-a', completed: true }),
    );
    updateProfile.mockClear();
    await expect(
      retryPendingAddPlaceTourAccountSync({ accountId: 'user-b' }),
    ).resolves.toBe(true);
    expect(updateProfile).not.toHaveBeenCalled();
    expect(await readAddPlaceTourAccountSyncPending('user-a')).toEqual({
      accountId: 'user-a',
      completed: true,
    });
  });

  it('A fail → B success does not clear A pending; A can still retry', async () => {
    updateProfile.mockRejectedValueOnce(new Error('a-network'));
    await completeAddPlaceTour({ accountId: 'user-a', existingPreferences: {} });
    expect(await readAddPlaceTourAccountSyncPending('user-a')).toEqual({
      accountId: 'user-a',
      completed: true,
    });

    updateProfile.mockResolvedValueOnce(undefined);
    await completeAddPlaceTour({ accountId: 'user-b', existingPreferences: {} });
    // B success must not wipe A's pending retry.
    expect(await readAddPlaceTourAccountSyncPending('user-a')).toEqual({
      accountId: 'user-a',
      completed: true,
    });
    expect(await readAddPlaceTourAccountSyncPending('user-b')).toBeNull();

    updateProfile.mockResolvedValueOnce(undefined);
    await expect(
      retryPendingAddPlaceTourAccountSync({
        accountId: 'user-a',
        existingPreferences: {},
      }),
    ).resolves.toBe(true);
    expect(await readAddPlaceTourAccountSyncPending('user-a')).toBeNull();
  });

  it('A fail → B fail keeps both pending independently (no overwrite)', async () => {
    updateProfile.mockRejectedValueOnce(new Error('a-network'));
    await completeAddPlaceTour({ accountId: 'user-a', existingPreferences: {} });

    updateProfile.mockRejectedValueOnce(new Error('b-network'));
    await completeAddPlaceTour({ accountId: 'user-b', existingPreferences: {} });

    expect(await readAddPlaceTourAccountSyncPending('user-a')).toEqual({
      accountId: 'user-a',
      completed: true,
    });
    expect(await readAddPlaceTourAccountSyncPending('user-b')).toEqual({
      accountId: 'user-b',
      completed: true,
    });

    // B retry success must not clear A.
    updateProfile.mockResolvedValueOnce(undefined);
    await expect(
      retryPendingAddPlaceTourAccountSync({ accountId: 'user-b' }),
    ).resolves.toBe(true);
    expect(await readAddPlaceTourAccountSyncPending('user-b')).toBeNull();
    expect(await readAddPlaceTourAccountSyncPending('user-a')).toEqual({
      accountId: 'user-a',
      completed: true,
    });
  });

  it('migrates matching legacy global pending into per-account key', async () => {
    await AsyncStorage.setItem(
      ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY,
      JSON.stringify({ accountId: 'user-a', completed: true }),
    );
    expect(await readAddPlaceTourAccountSyncPending('user-a')).toEqual({
      accountId: 'user-a',
      completed: true,
    });
    expect(await AsyncStorage.getItem(ADD_PLACE_TOUR_ACCOUNT_SYNC_PENDING_KEY)).toBeNull();
    expect(
      await AsyncStorage.getItem(addPlaceTourAccountSyncPendingKey('user-a')),
    ).toEqual(JSON.stringify({ accountId: 'user-a', completed: true }));
  });

  it('discards legacy unscoped pending markers', () => {
    expect(parseAddPlaceTourAccountSyncPending('1')).toBeNull();
    expect(parseAddPlaceTourAccountSyncPending('true')).toBeNull();
  });
});

describe('Add Place tour measure failure/retry (#162)', () => {
  it('measureTargetWithRetry eventually yields a non-zero rect or stays unready', async () => {
    const { measureTargetWithRetry } = await import('../featureTour/measureTarget');
    const sleep = jest.fn(async () => undefined);
    const failThenOk = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ x: 0, y: 0, width: 0, height: 0 })
      .mockResolvedValueOnce({ x: 12, y: 40, width: 44, height: 44 });
    const rect = await measureTargetWithRetry({
      measure: failThenOk,
      target: 'addPlaceCenter',
      maxAttempts: 5,
      sleep,
    });
    expect(isMeasuredTourRect(rect)).toBe(true);
    expect(failThenOk).toHaveBeenCalledTimes(3);

    const alwaysNull = jest.fn().mockResolvedValue(null);
    const missing = await measureTargetWithRetry({
      measure: alwaysNull,
      target: 'addPlaceFavoriteStar',
      maxAttempts: 2,
      sleep,
    });
    expect(isMeasuredTourRect(missing)).toBe(false);
    expect(
      areAddPlaceTourTargetsReady({ starRect: missing, centerRect: rect }),
    ).toBe(false);
  });
});
