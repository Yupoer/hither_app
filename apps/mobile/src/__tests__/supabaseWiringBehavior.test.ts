const mockCreateClient = jest.fn();
const mockWithAuthenticatedTransport = jest.fn();
const mockWithPerformanceTracing = jest.fn();
const mockConfigureDefaultAuthRecovery = jest.fn();
const mockReadLocalAuthActor = jest.fn();
const mockStorage = { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() };

jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));
jest.mock('../api/authStorage', () => ({ supabaseAuthStorage: mockStorage }));
jest.mock('../api/instrumentedSupabase', () => ({
  withSupabasePerformanceTracing: (...args: unknown[]) => mockWithPerformanceTracing(...args),
}));
jest.mock('../api/authenticatedTransport', () => ({
  withAuthenticatedTransport: (...args: unknown[]) => mockWithAuthenticatedTransport(...args),
}));
jest.mock('../api/authRecovery', () => ({
  configureDefaultAuthRecovery: (...args: unknown[]) => mockConfigureDefaultAuthRecovery(...args),
}));
jest.mock('../api/localAuthActor', () => ({
  defaultSupabaseAuthStorageKey: (url: string) => `default-key:${new URL(url).hostname}`,
  readLocalAuthActor: (...args: unknown[]) => mockReadLocalAuthActor(...args),
}));

const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const baseClient = {
  auth: { getSession: jest.fn(), refreshSession: jest.fn() },
  from: jest.fn(),
  rpc: jest.fn(),
};
const authController = { getSession: jest.fn(), refreshSessionOnce: jest.fn() };

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  mockCreateClient.mockReturnValue(baseClient);
  mockConfigureDefaultAuthRecovery.mockReturnValue(authController);
  mockWithAuthenticatedTransport.mockImplementation((client) => client);
  mockWithPerformanceTracing.mockImplementation((client) => client);
});

afterAll(() => {
  if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalAnonKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
});

describe('supabase wiring', () => {
  it('creates the base client with SecureStore-backed auth and wraps it in auth/performance seams', async () => {
    const module = require('../api/supabase') as typeof import('../api/supabase');
    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://project-ref.supabase.co',
      'anon-key',
      expect.objectContaining({
        auth: {
          storage: mockStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      }),
    );
    expect(mockConfigureDefaultAuthRecovery).toHaveBeenCalledWith(expect.objectContaining({
      getSession: expect.any(Function),
      refreshSession: expect.any(Function),
    }));
    expect(mockWithAuthenticatedTransport).toHaveBeenCalledWith(baseClient, { authRecovery: authController });
    expect(mockWithPerformanceTracing).toHaveBeenCalledWith(baseClient);
    expect(module.SUPABASE_AUTH_STORAGE_KEY).toBe('default-key:project-ref.supabase.co');
  });

  it('forwards auth adapter calls and reads local actor identity from the exact storage namespace', async () => {
    const capturedAdapter: any = {};
    mockConfigureDefaultAuthRecovery.mockImplementation((adapter: any) => {
      Object.assign(capturedAdapter, adapter);
      return authController;
    });
    baseClient.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'a' } }, error: null });
    baseClient.auth.refreshSession.mockResolvedValue({ data: { session: { access_token: 'b' } }, error: null });
    mockReadLocalAuthActor.mockResolvedValue('actor-1');

    const module = require('../api/supabase') as typeof import('../api/supabase');
    await expect(capturedAdapter.getSession()).resolves.toMatchObject({ data: { session: { access_token: 'a' } } });
    await expect(capturedAdapter.refreshSession()).resolves.toMatchObject({ data: { session: { access_token: 'b' } } });
    await expect(module.getLocalAuthActorId()).resolves.toBe('actor-1');
    expect(mockReadLocalAuthActor).toHaveBeenCalledWith(mockStorage, 'default-key:project-ref.supabase.co');
  });

  it('fails fast when the public Supabase configuration is incomplete', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    expect(() => require('../api/supabase')).toThrow('Missing Supabase env');
  });
});
