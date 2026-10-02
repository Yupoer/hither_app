const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
let mockActor: string | null = 'account-a';
const mockRevoke = jest.fn();
jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItem(...args),
  setItemAsync: (...args: unknown[]) => mockSetItem(...args), deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'fallback-installation-id' }));
jest.mock('../api/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: mockActor ? { user: { id: mockActor } } : null }, error: null }) },
  rpc: (...args: unknown[]) => mockRevoke(...args),
} }));
jest.mock('../native', () => ({ notifications: { getDevicePushToken: async () => 'native-token' },
  liveActivity: { listGroupActivities: async () => [] } }));

describe('installation auth storage compatibility', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); mockActor = 'account-a'; mockGetItem.mockResolvedValue(null); mockSetItem.mockResolvedValue(undefined); mockRevoke.mockResolvedValue({ error: null }); });
  it('keeps authenticated logout and account switch working with the existing ERR_KEY_CHAIN fallback', async () => {
    mockGetItem.mockRejectedValue({ code: 'ERR_KEY_CHAIN', message: 'missing entitlement' });
    const { supabaseAuthStorage } = require('../api/authStorage') as typeof import('../api/authStorage');
    const capabilities = require('../api/installationCapabilities') as typeof import('../api/installationCapabilities');
    await supabaseAuthStorage.setItem('auth-session', 'session-a');
    await capabilities.revokeInstallationCapabilities();
    expect(mockRevoke).toHaveBeenCalledWith('revoke_installation_capabilities', expect.objectContaining({ p_device_id: 'fallback-installation-id' }));
    expect(await supabaseAuthStorage.getItem('hither.live-activity-device-id')).toBe('fallback-installation-id');
    expect(mockSetItem).toHaveBeenCalledTimes(1); // Session write preceded the unavailable Keychain read.
    mockActor = 'account-b'; capabilities.resumeInstallationCapabilities();
    const register = jest.fn(); await capabilities.writeInstallationCapability('account-b', register);
    expect(register).toHaveBeenCalledWith('fallback-installation-id');
  });
  it('retries installation identity creation after an unrelated storage failure', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('storage write unavailable'));
    const capabilities = require('../api/installationCapabilities') as typeof import('../api/installationCapabilities');
    await expect(capabilities.getInstallationId()).rejects.toThrow('storage write unavailable');
    expect(await capabilities.getInstallationId()).toBe('fallback-installation-id');
    expect(mockSetItem).toHaveBeenCalledWith('hither.live-activity-device-id', 'fallback-installation-id');
  });
});
