/**
 * DailyAccommodationService clear path — must use atomic RPC (REVIEW_FIX r2).
 */
const rpc = jest.fn();
const from = jest.fn();

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

describe('DailyAccommodationService atomic clear (#161)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it('clearDailyAccommodation uses single clear+downgrade RPC (not split Data API writes)', async () => {
    await clearDailyAccommodation('group-1', '2026-08-11', 2);
    expect(rpc).toHaveBeenCalledWith('clear_daily_accommodation_with_downgrade', {
      p_group_id: 'group-1',
      p_stay_date: '2026-08-11',
      p_day: 2,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('clearDailyAccommodation passes null day when omitted', async () => {
    await clearDailyAccommodation('group-1', '2026-08-11');
    expect(rpc).toHaveBeenCalledWith('clear_daily_accommodation_with_downgrade', {
      p_group_id: 'group-1',
      p_stay_date: '2026-08-11',
      p_day: null,
    });
  });

  it('setDailyAccommodation still uses set RPC', async () => {
    rpc.mockResolvedValue({
      data: {
        daily: {
          id: 'd1',
          group_id: 'group-1',
          stay_date: '2026-08-11',
          title: 'Hotel',
          address: null,
          latitude: 1,
          longitude: 2,
        },
        auto_added: true,
        first_card_id: 'a',
        last_card_id: 'b',
      },
      error: null,
    });
    const result = await setDailyAccommodation('group-1', '2026-08-11', {
      title: 'Hotel',
      coordinates: { latitude: 1, longitude: 2 },
      day: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      'set_daily_accommodation_with_auto_add',
      expect.objectContaining({
        p_group_id: 'group-1',
        p_stay_date: '2026-08-11',
        p_title: 'Hotel',
        p_day: 1,
      }),
    );
    expect(result.autoAdded).toBe(true);
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
