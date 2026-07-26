type UpsertResult = { error: { code?: string; message?: string } | null };
type SelectResult = {
  data: Array<{ user_id: string; device_id: string }> | null;
  error: { code?: string; message?: string } | null;
};

const upsert = jest.fn(async (): Promise<UpsertResult> => ({ error: null }));
const update = jest.fn((_payload?: unknown) => undefined);
const selectEq = jest.fn();
const selectLimit = jest.fn(async (): Promise<SelectResult> => ({ data: [], error: null }));
const select = jest.fn(() => ({
  eq: (...args: unknown[]) => {
    selectEq(...args);
    return { limit: selectLimit };
  },
}));
const updateEqDevice = jest.fn(
  async (): Promise<{ error: { message?: string } | null }> => ({ error: null }),
);
const updateEqUser = jest.fn(() => ({ eq: updateEqDevice }));
const from = jest.fn((table: string) => {
  if (table === 'device_live_activity_tokens') {
    return {
      upsert,
      select,
      update: (payload: unknown) => {
        update(payload);
        return { eq: updateEqUser };
      },
    };
  }
  return { upsert, select };
});

jest.mock('../api/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { user: { id: 'user-1' } } },
        error: null,
      })),
    },
    from,
  },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000123'),
}));

import * as SecureStore from 'expo-secure-store';
import {
  getOrCreateLiveActivityDeviceId,
  upsertDeviceActivityToken,
} from '../api/services/LiveActivityService';

describe('device ActivityKit token service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    upsert.mockResolvedValue({ error: null });
    selectLimit.mockResolvedValue({ data: [], error: null });
  });

  it('creates and persists one stable device id', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);

    await expect(getOrCreateLiveActivityDeviceId()).resolves.toBe(
      '00000000-0000-4000-8000-000000000123',
    );
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'hither.live-activity-device-id',
      '00000000-0000-4000-8000-000000000123',
    );
  });

  it('upserts token rotation by user and device', async () => {
    await expect(
      upsertDeviceActivityToken('device-1234', 'a'.repeat(64), true),
    ).resolves.toBe('upserted');

    expect(from).toHaveBeenCalledWith('device_live_activity_tokens');
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        device_id: 'device-1234',
        push_to_start_token: 'a'.repeat(64),
        live_activities_enabled: true,
        updated_at: expect.any(String),
      },
      { onConflict: 'user_id,device_id' },
    );
  });

  it('deactivates the previous row when ActivityKit reports a null token', async () => {
    await upsertDeviceActivityToken('device-1234', null, true);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        push_to_start_token: null,
        live_activities_enabled: false,
      }),
      { onConflict: 'user_id,device_id' },
    );
  });

  it('treats user_id+device_id unique races as benign idempotent', async () => {
    upsert.mockResolvedValueOnce({
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "device_live_activity_tokens_pkey"',
      },
    });
    await expect(
      upsertDeviceActivityToken('device-1234', 'b'.repeat(64), true),
    ).resolves.toBe('benign_idempotent');
  });

  it('reclaims the same token from another own device after token unique conflict', async () => {
    const token = 'c'.repeat(64);
    upsert
      .mockResolvedValueOnce({
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "device_live_activity_tokens_token"',
        },
      })
      .mockResolvedValueOnce({ error: null });
    selectLimit.mockResolvedValueOnce({
      data: [{ user_id: 'user-1', device_id: 'old-device-9999' }],
      error: null,
    });

    await expect(
      upsertDeviceActivityToken('device-1234', token, true),
    ).resolves.toBe('reclaimed_own_token');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        push_to_start_token: null,
        live_activities_enabled: false,
      }),
    );
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('does not steal a token owned by another user', async () => {
    const token = 'd'.repeat(64);
    upsert.mockResolvedValueOnce({
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "device_live_activity_tokens_token"',
      },
    });
    selectLimit.mockResolvedValueOnce({
      data: [{ user_id: 'other-user', device_id: 'other-device' }],
      error: null,
    });

    await expect(
      upsertDeviceActivityToken('device-1234', token, true),
    ).resolves.toBe('foreign_token_conflict');
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('returns token_unique_unresolved when 23505 and select finds no owners (RLS)', async () => {
    const token = 'e'.repeat(64);
    upsert.mockResolvedValueOnce({
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "device_live_activity_tokens_token"',
      },
    });
    selectLimit.mockResolvedValueOnce({ data: [], error: null });

    await expect(
      upsertDeviceActivityToken('device-1234', token, true),
    ).resolves.toBe('token_unique_unresolved');
  });

  it('returns unknown_error when reclaim clear-update fails', async () => {
    const token = 'f'.repeat(64);
    upsert.mockResolvedValueOnce({
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "device_live_activity_tokens_token"',
      },
    });
    selectLimit.mockResolvedValueOnce({
      data: [{ user_id: 'user-1', device_id: 'old-device-9999' }],
      error: null,
    });
    updateEqDevice.mockResolvedValueOnce({ error: { message: 'update failed' } });

    await expect(
      upsertDeviceActivityToken('device-1234', token, true),
    ).resolves.toBe('unknown_error');
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
