import React from 'react';
import { configureDefaultAuthRecovery, __resetDefaultAuthRecoveryForTests } from '../api/authRecovery';
const mockOnboarding = jest.fn(async () => undefined);
const mockFlush = jest.fn(async () => undefined);
const mockGet = jest.fn(); const mockRefresh = jest.fn(); const mockLocal = jest.fn();
const mockProfile = jest.fn(); const mockStop = jest.fn(); const mockClearActivities = jest.fn();
const mockPremiumProjection = jest.fn(); const mockTripEntitlement = jest.fn();
const mockPurge = jest.fn(); const mockListeners = new Set<(event: string, session: unknown) => void>();
let mockAppListener: (state: string) => void;
const mockAuth = {
  getSession: mockGet, refreshSession: mockRefresh, startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn(),
  onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
    mockListeners.add(listener); return { data: { subscription: { unsubscribe: () => { mockListeners.delete(listener); } } } };
  },
};
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: (_event: string, listener: (state: string) => void) => {
  mockAppListener = listener; return { remove: jest.fn() };
} }, Linking: { addEventListener: () => ({ remove: jest.fn() }), getInitialURL: async () => null } }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('../api/supabase', () => ({ supabase: { auth: mockAuth,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => mockProfile() }) }), upsert: async () => ({ error: null }) }) } }));
jest.mock('../api/client', () => ({ updateNickname: jest.fn(), updateProfile: jest.fn(), getTripEntitlement: (...args: unknown[]) => mockTripEntitlement(...args), getPremiumProjection: (...args: unknown[]) => mockPremiumProjection(...args), restoreEntitlements: jest.fn() }));
jest.mock('../api/installationCapabilities', () => ({ resumeInstallationCapabilities: jest.fn() }));
jest.mock('../state/useAuthFlow', () => ({ useAuthFlow: () => ({}) }));
jest.mock('../state/locationOutbox', () => ({ purgeLocationOutbox: () => mockPurge() }));
jest.mock('../state/locationPrivacy', () => ({ setLocationAccessContext: jest.fn() }));
jest.mock('../state/backgroundJourney', () => ({ stopBackgroundJourney: (...args: unknown[]) => mockStop(...args) }));
jest.mock('../state/useLiveActivity', () => ({ clearLiveActivities: (...args: unknown[]) => mockClearActivities(...args) }));
jest.mock('../onboarding/sync', () => ({ syncOnboardingIfNeeded: mockOnboarding }));
jest.mock('../utils/activityLog', () => ({ flushQueuedEvents: mockFlush }));
jest.mock('../auth/callbacks', () => ({ beginAuthCallback: jest.fn(), consumeAuthCallback: jest.fn() }));
jest.mock('../constants/avatars', () => ({ displayMemberAvatar: () => ({ emoji: 'sheep' }) }));
jest.mock('../services/premiumProjectionCache', () => ({ readPremiumProjectionCache: async () => null, clearPremiumProjectionCache: async () => undefined, writePremiumProjectionCache: async () => undefined, cacheBlobToProjection: jest.fn(), isPremiumCacheStale: jest.fn() }));
jest.mock('../services/premiumPurchaseFlow', () => ({ ensurePersonalPremiumAccess: jest.fn() }));
jest.mock('../i18n', () => ({ getActiveLanguage: () => 'zh', translate: (_language: string, key: string) => key }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { create, act } = require('react-test-renderer');
const { SessionProvider, useSession } = require('../state/SessionContext') as typeof import('../state/SessionContext');
function SessionProbe(_props: { session: ReturnType<typeof useSession> }) { return null; }
function Observer() { return React.createElement(SessionProbe, { session: useSession() }); }
function readSnapshot(): ReturnType<typeof useSession> { return renderer.root.findByType(SessionProbe).props.session; }
let renderer: import('react-test-renderer').ReactTestRenderer;
async function drain() { for (let tick = 0; tick < 25; tick += 1) await Promise.resolve(); }
const stored = { access_token: 'old', refresh_token: 'refresh-old', expires_at: 9999999999,
  user: { id: 'account-a', email: 'user@example.test', user_metadata: { nickname: 'Local name' } } };
function emit(event: string, session: unknown) { for (const listener of mockListeners) listener(event, session); }

describe('SessionProvider restoration and expiry navigation state', () => {
  let consoleSpy: jest.SpyInstance;
  beforeAll(() => { const original = console.error; consoleSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (String(args[0]).startsWith('react-test-renderer is deprecated')) return;
    original(...args);
  }); });
  afterAll(() => { consoleSpy.mockRestore(); });
  beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks(); mockListeners.clear();
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    mockStop.mockResolvedValue(undefined); mockClearActivities.mockResolvedValue(undefined); mockPurge.mockResolvedValue(undefined);
    mockTripEntitlement.mockResolvedValue(null);
    mockPremiumProjection.mockResolvedValue({ personalPremiumActive: false, teamPremiumActive: false });
    mockLocal.mockResolvedValue({ data: { session: stored }, error: null });
    mockGet.mockImplementation(() => mockLocal());
    mockRefresh.mockResolvedValue({ data: { session: { ...stored, access_token: 'fresh' } }, error: null });
    mockProfile.mockResolvedValue({ data: { nickname: 'Server name' }, error: null });
    configureDefaultAuthRecovery({ getSession: mockGet, getLocalSession: mockLocal, refreshSession: mockRefresh });
  });
  afterEach(async () => { if (renderer) await act(async () => { renderer.unmount(); }); jest.useRealTimers(); __resetDefaultAuthRecoveryForTests(); });
  async function mount() { await act(async () => { renderer = create(React.createElement(SessionProvider, null, React.createElement(Observer))); await drain(); }); }
  it('restores local identity through offline refresh and failed profile enrichment, then retries automatically', async () => {
    mockRefresh.mockResolvedValueOnce({ data: { session: null }, error: { status: 503 } });
    mockProfile.mockResolvedValue({ data: null, error: { status: 503 } });
    await mount();
    expect(readSnapshot().user?.id).toBe('account-a'); expect(readSnapshot().user?.name).toBe('Local name'); expect(readSnapshot().initializing).toBe(false);
    expect(mockPurge).not.toHaveBeenCalled(); expect(mockStop).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(2_000); await drain(); });
    expect(mockRefresh).toHaveBeenCalledTimes(2); expect(readSnapshot().user?.id).toBe('account-a');
  });
  it('force-refreshes a healthy JWT at startup and each real foreground edge', async () => {
    await mount(); expect(mockRefresh).toHaveBeenCalledTimes(1);
    await act(async () => { jest.runOnlyPendingTimers(); await drain(); });
    await act(async () => { mockAppListener('background'); mockAppListener('active'); mockAppListener('active'); jest.runOnlyPendingTimers(); await drain(); });
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
  it('keeps a cold Keychain error on restore instead of presenting a false signed-out session', async () => {
    mockLocal.mockRejectedValueOnce(new Error('SecureStore temporarily unavailable'));
    await mount(); expect(readSnapshot().initializing).toBe(true); expect(mockStop).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(2_000); await drain(); });
    expect(readSnapshot().user?.id).toBe('account-a'); expect(readSnapshot().initializing).toBe(false);
  });
  it('does not treat an empty INITIAL_SESSION event as confirmed logout during recovery', async () => {
    await mount();
    await act(async () => { emit('INITIAL_SESSION', null); await drain(); });
    expect(readSnapshot().user?.id).toBe('account-a'); expect(mockPurge).not.toHaveBeenCalled();
  });
  it('clears identity/membership and stops native runtime on confirmed unrecoverable refresh without deleting drafts', async () => {
    await mount();
    await act(async () => { readSnapshot().setMembership({ group: { id: 'group-a' }, role: 'leader' } as never); await drain(); });
    mockRefresh.mockResolvedValueOnce({ data: { session: null }, error: { status: 400, code: 'refresh_token_not_found' } });
    await act(async () => { mockAppListener('background'); mockAppListener('active'); jest.runOnlyPendingTimers(); await drain(); });
    expect(readSnapshot().user).toBeNull(); expect(readSnapshot().membership).toBeNull();
    expect(mockStop).toHaveBeenCalledWith(true); expect(mockClearActivities).toHaveBeenCalledWith({ localOnly: true });
    // The provider never invokes anonymous-account deletion or core outbox purge.
    expect(mockPurge).not.toHaveBeenCalled();
  });
  it('restarts SDK auto refresh after terminal recovery and a new sign-in while already foregrounded', async () => {
    await mount();
    mockRefresh.mockResolvedValueOnce({ data: { session: null }, error: { status: 400, code: 'refresh_token_not_found' } });
    await act(async () => { mockAppListener('background'); mockAppListener('active'); jest.runOnlyPendingTimers(); await drain(); });
    expect(readSnapshot().user).toBeNull();
    const starts = mockAuth.startAutoRefresh.mock.calls.length;
    const next = { ...stored, access_token: 'new-access', refresh_token: 'new-refresh', user: { ...stored.user, id: 'account-b' } };
    mockLocal.mockResolvedValue({ data: { session: next }, error: null });
    await act(async () => { emit('SIGNED_IN', next); emit('TOKEN_REFRESHED', next); jest.runOnlyPendingTimers(); await drain(); });
    expect(readSnapshot().user?.id).toBe('account-b');
    expect(mockAuth.startAutoRefresh).toHaveBeenCalledTimes(starts + 1);
  });
  it('clears the prior actor ownership before a switched account profile can fail', async () => {
    // A was restored locally but never successfully enriched its profile.
    mockProfile.mockResolvedValue({ data: null, error: { status: 503 } });
    mockTripEntitlement.mockResolvedValue({ groupId: 'group-a', premium: true });
    mockPremiumProjection.mockResolvedValue({ personalPremiumActive: true, teamPremiumActive: true });
    await mount();
    await act(async () => { readSnapshot().setMembership({ group: { id: 'group-a' }, role: 'leader' } as never); await drain(); });
    await act(async () => { emit('PASSWORD_RECOVERY', stored); jest.runOnlyPendingTimers(); await drain(); });
    expect(readSnapshot().membership?.group.id).toBe('group-a'); expect(readSnapshot().isPro).toBe(true);
    expect(readSnapshot().isPasswordRecovery).toBe(true); expect(readSnapshot().tripEntitlement).not.toBeNull();
    const next = { ...stored, user: { ...stored.user, id: 'account-b' } };
    mockLocal.mockResolvedValue({ data: { session: next }, error: null });
    await act(async () => { emit('SIGNED_IN', next); jest.runOnlyPendingTimers(); await drain(); });
    expect(readSnapshot().user?.id).toBe('account-b'); expect(readSnapshot().membership).toBeNull();
    expect(readSnapshot().tripEntitlement).toBeNull(); expect(readSnapshot().isPro).toBe(false);
    expect(readSnapshot().isPasswordRecovery).toBe(false); expect(readSnapshot().passwordRecoverySuccess).toBe(false);
    expect(mockStop).toHaveBeenCalledWith(true); expect(mockClearActivities).toHaveBeenCalledWith({ localOnly: true });
    expect(mockPurge).toHaveBeenCalledTimes(1);
  });
  it('preserves same-actor membership and premium through a temporary profile failure', async () => {
    mockProfile.mockResolvedValue({ data: null, error: { status: 503 } });
    mockTripEntitlement.mockResolvedValue({ groupId: 'group-a', premium: true });
    mockPremiumProjection.mockResolvedValue({ personalPremiumActive: true, teamPremiumActive: true });
    await mount();
    await act(async () => { readSnapshot().setMembership({ group: { id: 'group-a' }, role: 'leader' } as never); await drain(); });
    await act(async () => { emit('TOKEN_REFRESHED', { ...stored, access_token: 'fresh' }); jest.runOnlyPendingTimers(); await drain(); });
    expect(readSnapshot().membership?.group.id).toBe('group-a'); expect(readSnapshot().isPro).toBe(true);
    expect(readSnapshot().tripEntitlement).not.toBeNull(); expect(mockStop).not.toHaveBeenCalled(); expect(mockPurge).not.toHaveBeenCalled();
  });
  it('ignores an old membership premium response after switching actors', async () => {
    mockProfile.mockResolvedValue({ data: null, error: { status: 503 } });
    let resolve!: (projection: unknown) => void;
    mockPremiumProjection.mockImplementationOnce(() => new Promise(next => { resolve = next; }));
    await mount();
    await act(async () => { readSnapshot().setMembership({ group: { id: 'group-a' }, role: 'leader' } as never); await drain(); });
    const next = { ...stored, user: { ...stored.user, id: 'account-b' } };
    await act(async () => { emit('SIGNED_IN', next); jest.runOnlyPendingTimers(); await drain(); });
    await act(async () => { resolve({ personalPremiumActive: true, teamPremiumActive: true }); await drain(); });
    expect(readSnapshot().user?.id).toBe('account-b'); expect(readSnapshot().membership).toBeNull(); expect(readSnapshot().isPro).toBe(false);
  });
  it('flushes again for a new same-account User object without restarting authentication', async () => {
    await mount();
    const count = mockOnboarding.mock.calls.length;
    const listeners = [...mockListeners];
    await act(async () => { emit('USER_UPDATED', stored); jest.runOnlyPendingTimers(); await drain(); });
    expect(readSnapshot().user?.id).toBe('account-a');
    expect(mockOnboarding.mock.calls.length).toBeGreaterThan(count);
    expect(mockFlush.mock.calls.length).toBe(mockOnboarding.mock.calls.length);
    expect([...mockListeners]).toEqual(listeners);
  });
  it('fences an in-flight entitlement across A to B to A and rejects stale actor callbacks', async () => {
    await mount();
    const previousRefresh = readSnapshot().refreshEntitlement;
    let resolve!: (trip: unknown) => void;
    mockTripEntitlement.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let pending!: ReturnType<typeof previousRefresh>;
    await act(async () => { pending = previousRefresh('group-a'); await drain(); });
    const next = { ...stored, user: { ...stored.user, id: 'account-b' } };
    await act(async () => { emit('SIGNED_IN', next); jest.runOnlyPendingTimers(); await drain(); });
    const calls = mockTripEntitlement.mock.calls.length;
    await act(async () => { expect(await previousRefresh('group-a')).toBeNull(); });
    expect(mockTripEntitlement).toHaveBeenCalledTimes(calls);
    await act(async () => { emit('SIGNED_IN', stored); jest.runOnlyPendingTimers(); await drain(); });
    await act(async () => { resolve({ groupId: 'group-a', premium: true }); await pending; });
    expect(readSnapshot().user?.id).toBe('account-a');
    expect(readSnapshot().tripEntitlement).toBeNull();
    expect(readSnapshot().isPro).toBe(false);
  });
  it('a late profile refresh cannot enrich a switched account', async () => {
    await mount();
    let resolve!: (profile: unknown) => void;
    mockProfile.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let pending!: Promise<void>;
    await act(async () => { pending = readSnapshot().refreshProfile(); await drain(); });
    const next = { ...stored, user: { ...stored.user, id: 'account-b' } };
    await act(async () => { emit('SIGNED_IN', next); jest.runOnlyPendingTimers(); await drain(); });
    await act(async () => { resolve({ data: { nickname: 'Old account name' }, error: null }); await pending; });
    expect(readSnapshot().user?.id).toBe('account-b');
    expect(readSnapshot().user?.name).toBe('Server name');
  });
  it('a late old profile response cannot resurrect the logged-out account', async () => {
    let resolve!: (result: unknown) => void;
    mockProfile.mockImplementation(() => new Promise(next => { resolve = next; }));
    await mount();
    await act(async () => { emit('SIGNED_OUT', null); resolve({ data: { nickname: 'old response' }, error: null }); await drain(); });
    expect(readSnapshot().user).toBeNull(); expect(readSnapshot().membership).toBeNull();
  });
});
