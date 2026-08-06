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
    await completeGroupFeatureTour({ existingPreferences: { quickCommand: undefined } });
    expect(storage.setItem).toHaveBeenCalledWith(GROUP_FEATURE_TOUR_STORAGE_KEY, '1');
    expect(updateProfile).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ groupFeatureTourCompleted: true }),
    });
  });

  it('does not throw when account sync fails after local write; marks pending retry', async () => {
    updateProfile.mockRejectedValueOnce(new Error('network'));
    await expect(completeGroupFeatureTour()).resolves.toBeUndefined();
    expect(storage.setItem).toHaveBeenCalledWith(GROUP_FEATURE_TOUR_STORAGE_KEY, '1');
    expect(storage.setItem).toHaveBeenCalledWith(
      GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY,
      '1',
    );
  });

  it('throws when local write fails so UI can keep the tour open', async () => {
    storage.setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(completeGroupFeatureTour()).rejects.toThrow('disk full');
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('retries pending account sync and clears the flag on success', async () => {
    storage.getItem.mockImplementation(async (key: string) =>
      key === GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY ? '1' : null,
    );
    updateProfile.mockResolvedValueOnce(undefined);
    await expect(
      retryPendingTourAccountSync({
        existingPreferences: { groupFeatureTourCompleted: true },
        completed: true,
      }),
    ).resolves.toBe(true);
    expect(updateProfile).toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith(
      GROUP_FEATURE_TOUR_ACCOUNT_SYNC_PENDING_KEY,
    );
  });

  it('reports pending account sync from storage', async () => {
    storage.getItem.mockResolvedValueOnce('1');
    expect(await isTourAccountSyncPending()).toBe(true);
  });

  it('clear removes local and sets account false', async () => {
    await clearGroupFeatureTour();
    expect(storage.removeItem).toHaveBeenCalledWith(GROUP_FEATURE_TOUR_STORAGE_KEY);
    expect(updateProfile).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ groupFeatureTourCompleted: false }),
    });
  });
});
