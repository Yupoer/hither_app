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
  createSupabaseAuthStorage,
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
    await expect(supabaseAuthStorage.getItem('session')).resolves.toBe('value');
    await supabaseAuthStorage.removeItem('session');

    expect(mockSetItemAsync).toHaveBeenCalledWith('session', 'value');
    expect(mockGetItemAsync).not.toHaveBeenCalled();
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('session');
  });

  it('keeps process-local credentials while retrying unavailable keychain persistence', async () => {
    mockSetItemAsync.mockRejectedValueOnce({
      code: 'ERR_KEY_CHAIN',
      message: 'A required entitlement is not present',
    });

    await supabaseAuthStorage.setItem('session', 'value');
    await expect(supabaseAuthStorage.getItem('session')).resolves.toBe('value');
    await supabaseAuthStorage.removeItem('session');
    await expect(supabaseAuthStorage.getItem('session')).resolves.toBeNull();

    expect(mockSetItemAsync).toHaveBeenCalledTimes(2);
    expect(mockGetItemAsync).not.toHaveBeenCalled();
    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it('does not swallow unrelated SecureStore errors', async () => {
    const error = new Error('SecureStore temporarily unavailable');
    mockGetItemAsync.mockRejectedValueOnce(error);

    await expect(supabaseAuthStorage.getItem('session')).rejects.toBe(error);
  });
});


describe('rotating credentials and logout persistence races', () => {
  function session(actor: string, refresh = 'refresh') {
    return JSON.stringify({ access_token: `access-${refresh}`, refresh_token: refresh, user: { id: actor } });
  }
  function adapter() {
    const disk = new Map<string, string>();
    return { disk, getItemAsync: jest.fn(async (key: string) => disk.get(key) ?? null),
      setItemAsync: jest.fn(async (key: string, value: string) => { disk.set(key, value); }),
      deleteItemAsync: jest.fn(async (key: string) => { disk.delete(key); }) };
  }
  it('retains the latest rotation through generic write failure and later flushes it', async () => {
    const secure = adapter(); secure.disk.set('auth', 'old');
    const { storage } = createSupabaseAuthStorage(secure);
    await expect(storage.getItem('auth')).resolves.toBe('old');
    secure.setItemAsync.mockRejectedValueOnce(new Error('device temporarily locked'));
    await storage.setItem('auth', 'new');
    expect(secure.disk.get('auth')).toBe('old');
    await expect(storage.getItem('auth')).resolves.toBe('new');
    expect(secure.disk.get('auth')).toBe('new');
  });
  it('serializes rotations and logout, preventing a pending flush from resurrecting credentials', async () => {
    const secure = adapter(); let release!: () => void;
    secure.setItemAsync.mockImplementationOnce(async (key, value) => {
      await new Promise<void>(resolve => { release = resolve; }); secure.disk.set(key, value);
    });
    const { storage } = createSupabaseAuthStorage(secure);
    const first = storage.setItem('auth', 'old');
    await Promise.resolve(); await Promise.resolve();
    const second = storage.setItem('auth', 'new');
    const logout = storage.removeItem('auth');
    release(); await Promise.all([first, second, logout]);
    expect(secure.disk.has('auth')).toBe(false);
    await expect(storage.getItem('auth')).resolves.toBeNull();
    expect(secure.setItemAsync).toHaveBeenCalledTimes(1);
  });
  it('keeps a logout tombstone through deletion failure and permits a subsequent fresh sign-in', async () => {
    const secure = adapter(); secure.disk.set('auth', 'old');
    secure.deleteItemAsync.mockRejectedValueOnce(new Error('device locked'));
    const { storage } = createSupabaseAuthStorage(secure);
    await storage.removeItem('auth');
    await expect(storage.getItem('auth')).resolves.toBeNull();
    expect(secure.disk.has('auth')).toBe(false);
    await storage.setItem('auth', 'next-user');
    await expect(storage.getItem('auth')).resolves.toBe('next-user');
  });
  it.each([true, false])('cannot cold-restore the old account after a failed replacement write (warm=%s)', async warm => {
    const secure = adapter(); const old = session('actor-a'); const replacement = session('actor-b');
    secure.disk.set('auth', old);
    const { storage } = createSupabaseAuthStorage(secure);
    if (warm) await storage.getItem('auth');
    secure.setItemAsync.mockRejectedValue(new Error('device locked'));
    await storage.setItem('auth', replacement);
    await expect(storage.getItem('auth')).resolves.toBe(replacement);
    expect(secure.disk.has('auth')).toBe(false);
    await expect(createSupabaseAuthStorage(secure).storage.getItem('auth')).resolves.toBeNull();
  });
  it('rejects a replacement when old-account deletion fails without publishing its identity', async () => {
    const secure = adapter(); const old = session('actor-a');
    secure.disk.set('auth', old);
    const { storage } = createSupabaseAuthStorage(secure);
    await storage.getItem('auth');
    const failure = new Error('old slot cannot be retired');
    secure.deleteItemAsync.mockRejectedValue(failure);
    await expect(storage.setItem('auth', session('actor-b'))).rejects.toBe(failure);
    await expect(storage.getItem('auth')).resolves.toBe(old);
    expect(secure.setItemAsync).not.toHaveBeenCalled();
    await expect(createSupabaseAuthStorage(secure).storage.getItem('auth')).resolves.toBe(old);
  });
  it('preserves same-account identity during rotation failure without deleting its persisted credential', async () => {
    const secure = adapter(); const old = session('actor-a', 'old'); const rotated = session('actor-a', 'new');
    secure.disk.set('auth', old);
    const { storage } = createSupabaseAuthStorage(secure);
    await storage.getItem('auth');
    secure.setItemAsync.mockRejectedValue(new Error('device locked'));
    await storage.setItem('auth', rotated);
    await expect(storage.getItem('auth')).resolves.toBe(rotated);
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
    await expect(createSupabaseAuthStorage(secure).storage.getItem('auth')).resolves.toBe(old);
  });
  it('still retires the old physical actor when a queued replacement is superseded by its rotation', async () => {
    const secure = adapter(); secure.disk.set('auth', session('actor-a'));
    const { storage } = createSupabaseAuthStorage(secure);
    await storage.getItem('auth');
    secure.setItemAsync.mockRejectedValue(new Error('device locked'));
    await Promise.all([storage.setItem('auth', session('actor-b', 'first')), storage.setItem('auth', session('actor-b', 'second'))]);
    await expect(storage.getItem('auth')).resolves.toBe(session('actor-b', 'second'));
    await expect(createSupabaseAuthStorage(secure).storage.getItem('auth')).resolves.toBeNull();
  });
});
