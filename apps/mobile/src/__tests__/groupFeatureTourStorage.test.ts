/**
 * Local tour flag read/write (AsyncStorage mocked).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GROUP_FEATURE_TOUR_STORAGE_KEY } from '../featureTour/constants';
import {
  clearGroupFeatureTour,
  completeGroupFeatureTour,
  GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY,
  isTourAccountSyncPending,
  readGroupFeatureTourCompletedLocal,
  readTourAccountSyncPending,
  retryPendingTourAccountSync,
  writeGroupFeatureTourCompletedLocal,
} from '../featureTour/storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const updateProfile = jest.fn().mockResolvedValue(undefined);
jest.mock('../api/services/ProfileService', () => ({
  updateProfile: (...args: unknown[]) => updateProfile(...args),
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('group feature tour storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads local completion flag', async () => {
    storage.getItem.mockResolvedValueOnce('1');
    expect(await readGroupFeatureTourCompletedLocal()).toBe(true);
    expect(storage.getItem).toHaveBeenCalledWith(GROUP_FEATURE_TOUR_STORAGE_KEY);

    storage.getItem.mockResolvedValueOnce(null);
    expect(await readGroupFeatureTourCompletedLocal()).toBe(false);
  });

  it('writes and clears local flag', async () => {
    await writeGroupFeatureTourCompletedLocal(true);
    expect(storage.setItem).toHaveBeenCalledWith(GROUP_FEATURE_TOUR_STORAGE_KEY, '1');
    await writeGroupFeatureTourCompletedLocal(false);
    expect(storage.removeItem).toHaveBeenCalledWith(GROUP_FEATURE_TOUR_STORAGE_KEY);
  });

  it('completes local first then best-effort account sync', async () => {
    await completeGroupFeatureTour({
      accountId: 'u1',
      existingPreferences: { quickCommand: undefined },
    });
    expect(storage.setItem).toHaveBeenCalledWith(GROUP_FEATURE_TOUR_STORAGE_KEY, '1');
    expect(updateProfile).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ groupFeatureTourCompleted: true }),
    });
  });

  it('does not throw when account sync fails after local write; marks per-account pending', async () => {
    updateProfile.mockRejectedValueOnce(new Error('network'));
    await expect(
      completeGroupFeatureTour({ accountId: 'user-a' }),
    ).resolves.toBeUndefined();
    expect(storage.setItem).toHaveBeenCalledWith(GROUP_FEATURE_TOUR_STORAGE_KEY, '1');
    expect(storage.setItem).toHaveBeenCalledWith(
      GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY,
      JSON.stringify({ accountId: 'user-a', completed: true }),
    );
  });

  it('throws when local write fails so UI can keep the tour open', async () => {
    storage.setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(completeGroupFeatureTour({ accountId: 'u1' })).rejects.toThrow('disk full');
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('retries pending account sync with stored desired value and clears on success', async () => {
    storage.getItem.mockImplementation(async (key: string) =>
      key === GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY
        ? JSON.stringify({ accountId: 'user-a', completed: false })
        : null,
    );
    updateProfile.mockResolvedValueOnce(undefined);
    await expect(
      retryPendingTourAccountSync({
        accountId: 'user-a',
        existingPreferences: { groupFeatureTourCompleted: true },
      }),
    ).resolves.toBe(true);
    expect(updateProfile).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ groupFeatureTourCompleted: false }),
    });
    expect(storage.removeItem).toHaveBeenCalledWith(
      GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY,
    );
  });

  it('reports pending account sync from storage', async () => {
    storage.getItem.mockResolvedValueOnce(
      JSON.stringify({ accountId: 'u', completed: true }),
    );
    expect(await isTourAccountSyncPending()).toBe(true);
    storage.getItem.mockResolvedValueOnce(
      JSON.stringify({ accountId: 'u', completed: true }),
    );
    expect(await readTourAccountSyncPending()).toEqual({
      accountId: 'u',
      completed: true,
    });
  });

  it('clear removes local and sets account false with account id', async () => {
    await clearGroupFeatureTour({ accountId: 'user-a' });
    expect(storage.removeItem).toHaveBeenCalledWith(GROUP_FEATURE_TOUR_STORAGE_KEY);
    expect(updateProfile).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ groupFeatureTourCompleted: false }),
    });
  });
});
