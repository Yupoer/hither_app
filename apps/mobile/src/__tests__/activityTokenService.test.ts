const upsert = jest.fn(async () => ({ error: null }));
const from = jest.fn(() => ({ upsert }));

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
    await upsertDeviceActivityToken('device-1234', 'a'.repeat(64), true);

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
});
