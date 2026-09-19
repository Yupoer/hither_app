jest.mock('../api/supabase', () => ({
  supabase: {
    getLocalAuthActorId: jest.fn(),
    auth: { getSession: jest.fn(), refreshSession: jest.fn() },
  },
}));

import { supabase } from '../api/supabase';
import {
  __resetDefaultAuthRecoveryForTests,
  configureDefaultAuthRecovery,
} from '../api/authRecovery';
import {
  generateInviteCode,
  isNetworkRequestError,
  orThrow,
  requireAuthenticatedSession,
  requireUserId,
  runAuthenticatedOperation,
  sleep,
} from '../api/services/_helpers';

const mockedSupabase = supabase as unknown as {
  getLocalAuthActorId: jest.Mock;
  auth: { getSession: jest.Mock; refreshSession: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  __resetDefaultAuthRecoveryForTests();
  mockedSupabase.auth.getSession.mockResolvedValue({
    data: { session: { access_token: 'token', user: { id: 'user-1' } } }, error: null,
  });
  mockedSupabase.auth.refreshSession.mockResolvedValue({
    data: { session: { access_token: 'refreshed', user: { id: 'user-1' } } }, error: null,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('_helpers auth and error seams', () => {
  it('generates a six-character code from the safe invite alphabet', () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it('uses the fallback auth controller for session, user, and operation helpers', async () => {
    await expect(requireAuthenticatedSession()).resolves.toMatchObject({
      access_token: 'token', user: { id: 'user-1' },
    });
    await expect(requireUserId()).resolves.toBe('user-1');
    await expect(runAuthenticatedOperation('test.read', (session) => ({ id: session.user?.id }), {
      recoverOnce: false,
    })).resolves.toEqual({ id: 'user-1' });
  });

  it('prefers the configured recovery controller over the legacy auth seam', async () => {
    const configured = configureDefaultAuthRecovery({
      getSession: jest.fn(async () => ({ data: { session: { access_token: 'configured', user: { id: 'configured-user' } } }, error: null })),
      refreshSession: jest.fn(async () => ({ data: { session: { access_token: 'configured-refresh', user: { id: 'configured-user' } } }, error: null })),
    });
    await expect(requireUserId()).resolves.toBe('configured-user');
    await expect(runAuthenticatedOperation('test.write', (session) => session.access_token, { mutation: true })).resolves.toBe('configured');
    expect(configured).toBeDefined();
    expect(mockedSupabase.auth.getSession).not.toHaveBeenCalled();
  });

  it('fails closed when the fallback session has no usable user id', async () => {
    mockedSupabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'token', user: null } }, error: null,
    });
    await expect(requireUserId()).rejects.toMatchObject({ code: 'session_missing_or_expired', status: 401 });

    mockedSupabase.auth.getSession.mockResolvedValue({ data: null, error: null });
    mockedSupabase.auth.refreshSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(requireAuthenticatedSession()).rejects.toMatchObject({ code: 'session_missing_or_expired' });
  });

  it('recognizes mobile transport errors without labeling business errors as offline', () => {
    expect(isNetworkRequestError({ message: 'Network request failed' })).toBe(true);
    expect(isNetworkRequestError(new Error('Failed to fetch'))).toBe(true);
    expect(isNetworkRequestError('the network connection was lost')).toBe(true);
    expect(isNetworkRequestError({ code: '42501', message: 'leader membership required' })).toBe(false);
    expect(isNetworkRequestError(null)).toBe(false);
  });

  it('throws structured Supabase errors with their provider cause and handles strings', () => {
    expect(() => orThrow(null)).not.toThrow();
    const provider = { code: '42501', status: 403, message: 'permission denied', details: 'RLS' };
    try {
      orThrow(provider);
    } catch (error) {
      expect(error).toMatchObject({ code: '42501', status: 403, details: 'RLS', cause: provider });
    }
    expect(() => orThrow('bad request')).toThrow('bad request');
    expect(() => orThrow({ code: 'unknown' })).toThrow('Supabase operation failed');
  });

  it('provides an injectable sleep used by service retries', async () => {
    jest.useFakeTimers();
    const pending = sleep(25);
    jest.advanceTimersByTime(24);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(pending).resolves.toBeUndefined();
  });
});
