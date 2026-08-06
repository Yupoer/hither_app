/**
 * Local tour flag read/write (AsyncStorage mocked).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GROUP_FEATURE_TOUR_STORAGE_KEY } from '../featureTour/constants';
import {
  clearGroupFeatureTour,
  completeGroupFeatureTour,
  readGroupFeatureTourCompletedLocal,
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

  it('does not throw when account sync fails after local write', async () => {
    updateProfile.mockRejectedValueOnce(new Error('network'));
    await expect(completeGroupFeatureTour()).resolves.toBeUndefined();
    expect(storage.setItem).toHaveBeenCalled();
  });

  it('clear removes local and sets account false', async () => {
    await clearGroupFeatureTour();
    expect(storage.removeItem).toHaveBeenCalledWith(GROUP_FEATURE_TOUR_STORAGE_KEY);
    expect(updateProfile).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ groupFeatureTourCompleted: false }),
    });
  });
});
