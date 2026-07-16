jest.mock('../api/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-1' } } },
        error: null,
      }),
    },
  },
}));

import { supabase } from '../api/supabase';
import {
  ackNavigationSession,
  cancelNavigationSession,
  startNavigationSession,
} from '../api/services/NavigationService';

const sessionRow = {
  id: 'session-1',
  group_id: 'group-1',
  destination_id: 'destination-1',
  destination_name: '車站',
  destination_latitude: 25.0478,
  destination_longitude: 121.517,
  arrival_radius_m: 50,
  started_by: 'leader-1',
  request_id: 'request-1',
  started_at: '2026-07-17T00:00:00Z',
  expires_at: '2026-07-17T06:00:00Z',
  status: 'active',
  version: 1,
};

describe('NavigationService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts an idempotent session and maps the database row', async () => {
    jest.mocked(supabase.rpc).mockResolvedValueOnce({
      data: sessionRow,
      error: null,
    } as never);

    await expect(
      startNavigationSession('group-1', 'destination-1', 'request-1'),
    ).resolves.toMatchObject({
      id: 'session-1',
      groupId: 'group-1',
      requestId: 'request-1',
      destination: {
        name: '車站',
        coordinates: { latitude: 25.0478, longitude: 121.517 },
        arrivalRadiusMeters: 50,
      },
      version: 1,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('start_navigation_session', {
      p_group_id: 'group-1',
      p_destination_id: 'destination-1',
      p_request_id: 'request-1',
    });
  });

  it('cancels with optimistic version protection', async () => {
    jest.mocked(supabase.rpc).mockResolvedValueOnce({
      data: { ...sessionRow, status: 'cancelled', version: 2 },
      error: null,
    } as never);

    await expect(cancelNavigationSession('session-1', 1)).resolves.toMatchObject({
      status: 'cancelled',
      version: 2,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('cancel_navigation_session', {
      p_session_id: 'session-1',
      p_expected_version: 1,
    });
  });

  it('acknowledges the current member without accepting an invalid status', async () => {
    jest.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        navigation_session_id: 'session-1',
        user_id: 'user-1',
        local_status: 'tracking_active',
        detail: { source: 'realtime' },
        latest_distance_m: null,
        latest_accuracy_m: null,
        live_activity_id: null,
        acknowledged_at: '2026-07-17T00:00:01Z',
        arrived_at: null,
        updated_at: '2026-07-17T00:00:01Z',
      },
      error: null,
    } as never);

    await expect(
      ackNavigationSession('session-1', 'tracking_active', { source: 'realtime' }),
    ).resolves.toMatchObject({
      navigationSessionId: 'session-1',
      userId: 'user-1',
      localStatus: 'tracking_active',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('ack_navigation_session', {
      p_session_id: 'session-1',
      p_status: 'tracking_active',
      p_detail: { source: 'realtime' },
    });
  });
});
