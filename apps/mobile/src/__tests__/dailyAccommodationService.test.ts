/**
 * DailyAccommodationService writes queue an atomic local projection + operation.
 */
const rpc = jest.fn();
const from = jest.fn();
const mockEnqueueDaily = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => 'local-stay-id' }));
jest.mock('../state/coreDataSync', () => ({
  ensureCoreSnapshot: async () => ({ dailyAccommodations: [] }),
  enqueueDailyAccommodation: (...args: unknown[]) => mockEnqueueDaily(...args),
}));

jest.mock('../api/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

jest.mock('../api/demo', () => ({
  isDemoGroup: (id: string) => id.startsWith('demo-'),
}));

import {
  clearDailyAccommodation,
  setAccommodationAutoAdd,
  setDailyAccommodation,
} from '../api/services/DailyAccommodationService';

describe('DailyAccommodationService durable writes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it('clearDailyAccommodation queues clear+downgrade without remote prerequisites', async () => {
    await clearDailyAccommodation('group-1', '2026-08-11', 2);
    expect(mockEnqueueDaily).toHaveBeenCalledWith({
      groupId: 'group-1', stayDate: '2026-08-11', day: 2,
    });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('clearDailyAccommodation omits day when omitted', async () => {
    await clearDailyAccommodation('group-1', '2026-08-11');
    expect(mockEnqueueDaily).toHaveBeenCalledWith({
      groupId: 'group-1', stayDate: '2026-08-11', day: undefined,
    });
  });

  it('setDailyAccommodation saves a durable stay and returns with auto-add off', async () => {
    const result = await setDailyAccommodation('group-1', '2026-08-11', {
      title: 'Hotel',
      coordinates: { latitude: 1, longitude: 2 },
      day: 1,
    });
    expect(mockEnqueueDaily).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'group-1', stayDate: '2026-08-11', day: 1,
      daily: expect.objectContaining({ id: 'local-stay-id', title: 'Hotel' }),
    }));
    expect(rpc).not.toHaveBeenCalled();
    expect(result.autoAdded).toBe(false);
    expect(result.daily.title).toBe('Hotel');
  });

  it('setAccommodationAutoAdd uses expiry-aware RPC (not legacy groups UPDATE)', async () => {
    await setAccommodationAutoAdd('group-1', false);
    expect(rpc).toHaveBeenCalledWith('set_accommodation_auto_add', {
      p_group_id: 'group-1',
      p_enabled: false,
    });
    expect(from).not.toHaveBeenCalled();
  });
});
