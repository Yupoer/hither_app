let mockActor: string | null = 'account-a';
const mockRpc = jest.fn();
const mockSignOut = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => 'installation-id' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: async () => 'installation-id' }));
jest.mock('../native', () => ({ notifications: { getDevicePushToken: async () => 'native-push' },
  liveActivity: { listGroupActivities: async () => [{ activityId: 'native-activity' }] } }));
jest.mock('../api/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: mockActor ? { user: { id: mockActor } } : null }, error: null }), signOut: (...args: unknown[]) => mockSignOut(...args) },
  rpc: (...args: unknown[]) => mockRpc(...args),
} }));
import { changeAuthSession, revokeInstallationCapabilities, resumeInstallationCapabilities, writeInstallationCapability } from '../api/installationCapabilities';
import { getSharedLiveActivityTokenGate } from '../utils/liveActivityTokenGate';

describe('installation capability lifecycle', () => {
  beforeEach(() => { mockActor = 'account-a'; resumeInstallationCapabilities(); jest.clearAllMocks(); mockRpc.mockResolvedValue({ error: null }); mockSignOut.mockResolvedValue({ error: null }); });
  it('drains an in-flight registration before revoking and fences queued registrations', async () => {
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const inFlight = writeInstallationCapability('account-a', async () => { started(); await new Promise<void>(resolve => { finish = resolve; }); });
    await ready;
    const queuedWrite = jest.fn();
    const queued = writeInstallationCapability('account-a', queuedWrite);
    const revoke = revokeInstallationCapabilities();
    expect(mockRpc).not.toHaveBeenCalled();
    finish(); await inFlight; await queued; await revoke;
    expect(queuedWrite).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledWith('revoke_installation_capabilities', {
      p_device_id: 'installation-id', p_push_token: 'native-push', p_activity_ids: ['native-activity'],
    });
    const late = jest.fn(); await writeInstallationCapability('account-a', late);
    expect(late).not.toHaveBeenCalled();
  });
  it('reports revocation failure and retries before old auth is lost', async () => {
    mockRpc.mockResolvedValueOnce({ error: new Error('offline') });
    await expect(revokeInstallationCapabilities()).rejects.toThrow('offline');
    expect(mockActor).toBe('account-a');
    await revokeInstallationCapabilities();
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
  it('rejects an old account registration after switching and accepts the new account', async () => {
    await revokeInstallationCapabilities(); mockActor = 'account-b'; resumeInstallationCapabilities();
    const oldWrite = jest.fn(); await writeInstallationCapability('account-a', oldWrite);
    expect(oldWrite).not.toHaveBeenCalled();
    const newWrite = jest.fn(); await writeInstallationCapability('account-b', newWrite);
    expect(newWrite).toHaveBeenCalledWith('installation-id');
  });
  it('does not call revocation RPC without an authenticated session', async () => {
    mockActor = null; await revokeInstallationCapabilities(); expect(mockRpc).not.toHaveBeenCalled();
  });
  it('serializes account changes and signs out locally when authentication fails', async () => {
    let finish!: () => void;
    const first = changeAuthSession(async () => new Promise<void>(resolve => { finish = resolve; }));
    const secondOperation = jest.fn(async () => ({ error: new Error('bad password') }));
    const second = changeAuthSession(secondOperation);
    while (!finish) await Promise.resolve();
    expect(secondOperation).not.toHaveBeenCalled();
    finish(); await first;
    expect((await second).error.message).toBe('bad password');
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('keeps logout failures retryable and reports failed sign-in cleanup explicitly', async () => {
    await expect(changeAuthSession(async () => { throw new Error('delete RPC failed'); }, true, false)).rejects.toThrow('delete RPC failed');
    expect(mockSignOut).not.toHaveBeenCalled();
    mockSignOut.mockResolvedValue({ error: new Error('offline') });
    await expect(changeAuthSession(async () => { throw new Error('bad password'); })).rejects.toThrow('retry sign-out');
  });
  it('allows the same account and push-to-start token to register after successful logout', async () => {
    const gate = getSharedLiveActivityTokenGate();
    await gate.ready();
    const identity = { userId: 'account-a', deviceId: 'installation-id', token: 'same-token', enabled: true };
    gate.recordResult(identity, 'upserted');
    expect(gate.shouldRegister(identity)).toEqual({ action: 'skip', reason: 'idempotent_cache' });
    await revokeInstallationCapabilities();
    resumeInstallationCapabilities();
    expect(gate.shouldRegister(identity)).toEqual({ action: 'register' });
    const register = jest.fn();
    await writeInstallationCapability('account-a', register);
    expect(register).toHaveBeenCalledWith('installation-id');
  });
  it('waits for gate hydration before clearing cached conflicts and leaves it intact if revoke fails', async () => {
    const gate = getSharedLiveActivityTokenGate();
    const identity = { userId: 'account-a', deviceId: 'installation-id', token: 'same-token', enabled: true };
    gate.recordResult(identity, 'foreign_token_conflict');
    mockRpc.mockResolvedValueOnce({ error: new Error('offline') });
    await expect(revokeInstallationCapabilities()).rejects.toThrow('offline');
    expect(gate.shouldRegister(identity)).toEqual({ action: 'skip', reason: 'permanent_conflict' });
    let hydrate!: () => void;
    const ready = jest.spyOn(gate, 'ready').mockImplementationOnce(() => new Promise<void>(resolve => { hydrate = resolve; }));
    const revoked = revokeInstallationCapabilities();
    while (!hydrate) await Promise.resolve();
    expect(gate.shouldRegister(identity).action).toBe('skip');
    hydrate(); await revoked;
    expect(gate.shouldRegister(identity)).toEqual({ action: 'register' });
    ready.mockRestore();
  });
});
