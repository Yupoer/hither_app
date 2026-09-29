jest.mock('../api/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

import { supabase } from '../api/supabase';
import {
  saveOnboardingProfile,
  updateNickname,
  updateProfile,
} from '../api/services/ProfileService';

const mockedSupabase = supabase as unknown as {
  auth: { getSession: jest.Mock };
  rpc: jest.Mock;
  from: jest.Mock;
};

const query = (result: unknown) => {
  const builder: any = {};
  for (const method of ['update', 'upsert', 'eq', 'select']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.maybeSingle = jest.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedSupabase.auth.getSession.mockResolvedValue({
    data: { session: { access_token: 'token', user: { id: 'user-1' } } },
    error: null,
  });
});

describe('ProfileService', () => {
  it('trims and updates a nickname when the profile row exists', async () => {
    const update = query({ data: { id: 'user-1' }, error: null });
    mockedSupabase.from.mockReturnValue(update);

    await expect(updateNickname('  Ada  ')).resolves.toBe('Ada');
    expect(update.update).toHaveBeenCalledWith({ nickname: 'Ada' });
    expect(update.eq).toHaveBeenCalledWith('id', 'user-1');
    expect(mockedSupabase.from).toHaveBeenCalledTimes(1);
  });

  it('upserts a missing nickname row and rejects blank nicknames', async () => {
    const update = query({ data: null, error: null });
    const insert = query({ data: null, error: null });
    mockedSupabase.from.mockReturnValueOnce(update).mockReturnValueOnce(insert);

    await expect(updateNickname('  Bob  ')).resolves.toBe('Bob');
    expect(insert.upsert).toHaveBeenCalledWith(
      { id: 'user-1', nickname: 'Bob' },
      { onConflict: 'id' },
    );

    await expect(updateNickname('   ')).rejects.toThrow('暱稱不能為空');
    expect(mockedSupabase.from).toHaveBeenCalledTimes(2);
  });

  it('serializes profile preferences and upserts when update affects no row', async () => {
    const update = query({ data: null, error: null });
    const insert = query({ data: null, error: null });
    mockedSupabase.from.mockReturnValueOnce(update).mockReturnValueOnce(insert);
    const preferences = { quickCommand: { enabled: true }, theme: 'dark' } as any;

    await expect(updateProfile({
      nickname: '  Zoe ',
      avatar: '🦊',
      avatarColor: '#abc',
      preferences,
    })).resolves.toBeUndefined();

    expect(update.update).toHaveBeenCalledWith({
      nickname: 'Zoe',
      avatar: '🦊',
      avatar_color: '#abc',
      preferences,
    });
    expect(insert.upsert).toHaveBeenCalledWith(
      { id: 'user-1', nickname: 'Zoe', avatar: '🦊', avatar_color: '#abc', preferences },
      { onConflict: 'id' },
    );
  });

  it('does not authenticate or write for an empty profile patch', async () => {
    await expect(updateProfile({ nickname: '  ', avatar: '', avatarColor: '' })).resolves.toBeUndefined();
    expect(mockedSupabase.auth.getSession).not.toHaveBeenCalled();
    expect(mockedSupabase.from).not.toHaveBeenCalled();
  });

  it('writes onboarding answers through the authenticated profile row', async () => {
    const update = query({ data: null, error: null });
    mockedSupabase.from.mockReturnValue(update);

    await expect(saveOnboardingProfile({ pace: 'slow' })).resolves.toBeUndefined();
    expect(update.update).toHaveBeenCalledWith({ onboarding: { pace: 'slow' } });
    expect(update.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('preserves provider errors from profile writes', async () => {
    const failure = { code: '42501', message: 'permission denied', status: 403 };
    const update = query({ data: null, error: failure });
    mockedSupabase.from.mockReturnValue(update);

    await expect(saveOnboardingProfile({ pace: 'fast' })).rejects.toMatchObject({
      code: '42501',
      status: 403,
      cause: failure,
    });
  });

  it('forwards the legacy entitlement exports without weakening their server boundary', async () => {
    const { redeemPromoCode, setProStatus } = await import('../api/services/ProfileService');
    mockedSupabase.rpc.mockResolvedValueOnce({
      data: { success: true, plan_name: 'Premium', plan_code: 'premium' }, error: null,
    });
    await expect(redeemPromoCode('  promo  ', 'g-1')).resolves.toMatchObject({
      plan_name: 'Premium', plan_code: 'premium',
    });
    expect(mockedSupabase.rpc).toHaveBeenCalledWith('redeem_promo_code', {
      p_code: 'promo', p_group_id: 'g-1',
    });
    await expect(setProStatus('user-1')).rejects.toThrow('entitlement_write_forbidden');
  });
});
