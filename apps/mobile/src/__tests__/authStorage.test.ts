const mockGetItemAsync = jest.fn();
const mockSetItemAsync = jest.fn();
const mockDeleteItemAsync = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSetItemAsync(...args),
  deleteItemAsync: (...args: unknown[]) => mockDeleteItemAsync(...args),
}));

import {
  __resetAuthStorageForTests,
  supabaseAuthStorage,
} from '../api/authStorage';

describe('Supabase Auth storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetAuthStorageForTests();
    mockGetItemAsync.mockResolvedValue(null);
    mockSetItemAsync.mockResolvedValue(undefined);
    mockDeleteItemAsync.mockResolvedValue(undefined);
  });

  it('keeps the normal signed-app path on SecureStore', async () => {
    await supabaseAuthStorage.setItem('session', 'value');
    await expect(supabaseAuthStorage.getItem('session')).resolves.toBeNull();
    await supabaseAuthStorage.removeItem('session');

    expect(mockSetItemAsync).toHaveBeenCalledWith('session', 'value');
    expect(mockGetItemAsync).toHaveBeenCalledWith('session');
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('session');
  });

  it('falls back to process-local memory for missing keychain entitlements', async () => {
    mockSetItemAsync.mockRejectedValueOnce({
      code: 'ERR_KEY_CHAIN',
      message: 'A required entitlement is not present',
    });

    await supabaseAuthStorage.setItem('session', 'value');
    await expect(supabaseAuthStorage.getItem('session')).resolves.toBe('value');
    await supabaseAuthStorage.removeItem('session');
    await expect(supabaseAuthStorage.getItem('session')).resolves.toBeNull();

    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
    expect(mockGetItemAsync).not.toHaveBeenCalled();
    expect(mockDeleteItemAsync).not.toHaveBeenCalled();
  });

  it('does not swallow unrelated SecureStore errors', async () => {
    const error = new Error('SecureStore temporarily unavailable');
    mockGetItemAsync.mockRejectedValueOnce(error);

    await expect(supabaseAuthStorage.getItem('session')).rejects.toBe(error);
  });
});
