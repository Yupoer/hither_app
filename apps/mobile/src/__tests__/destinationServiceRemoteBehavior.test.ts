jest.mock('../api/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));
jest.mock('../state/coreDataSync', () => {
  throw new Error('native durable adapter intentionally unavailable in remote contract tests');
});
jest.mock('../api/demo', () => ({
  isDemoGroup: () => false,
  demoAddDestination: jest.fn(),
  demoAddDestinationsBatch: jest.fn(),
  demoUpdateDestinationEmoji: jest.fn(),
}));

import { supabase } from '../api/supabase';
import {
  addDestination,
  completeGatheringStop,
  deleteDestination,
  reorderDestinations,
  setDestinationMeetTime,
  updateDestinationEmojiColor,
} from '../api/services/DestinationService';

const mockedSupabase = supabase as unknown as { rpc: jest.Mock; from: jest.Mock };

const query = (result: unknown) => {
  const builder: any = {};
  for (const method of ['update', 'eq', 'select']) builder[method] = jest.fn(() => builder);
  builder.maybeSingle = jest.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DestinationService remote adapter', () => {
  it('adds remotely and maps server-side itinerary limits', async () => {
    mockedSupabase.rpc.mockResolvedValueOnce({ data: 'remote-1', error: null });
    await expect(addDestination('g-1', {
      title: 'Stop', coordinates: { latitude: 1, longitude: 2 }, day: 3,
    })).resolves.toBe('remote-1');
    expect(mockedSupabase.rpc).toHaveBeenCalledWith('add_itinerary_item', expect.objectContaining({
      p_day: 3, p_kind: 'stop', p_stay_anchor: false,
    }));

    mockedSupabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0004', message: 'limit' } });
    await expect(addDestination('g-1', {
      title: 'Too many', coordinates: { latitude: 1, longitude: 2 },
    })).rejects.toMatchObject({ code: 'itinerary_point_limit' });
  });

  it('updates, deletes, completes, and reorders through remote RPCs', async () => {
    mockedSupabase.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: 2, error: null });
    await deleteDestination('g-1', 'd-1');
    await completeGatheringStop('g-1', 'd-1');
    await reorderDestinations('g-1', [
      { id: 'd-1', position: 0, day: null, meetAt: '2026-09-19', stayAnchor: false },
      { id: 'd-2', position: 1, day: 1 },
    ]);
    expect(mockedSupabase.rpc).toHaveBeenNthCalledWith(1, 'delete_destination', { p_group_id: 'g-1', p_destination_id: 'd-1' });
    expect(mockedSupabase.rpc).toHaveBeenNthCalledWith(2, 'complete_gathering_stop', { p_group_id: 'g-1', p_destination_id: 'd-1' });

    mockedSupabase.rpc.mockResolvedValueOnce({ data: 1, error: null });
    await expect(reorderDestinations('g-1', [{ id: 'd-1', position: 0, day: null }, { id: 'd-2', position: 1, day: 1 }]))
      .rejects.toMatchObject({ code: 'reorder_incomplete' });
  });

  it('persists validated marker patches and exposes silent RLS misses', async () => {
    mockedSupabase.from.mockReturnValueOnce(query({ data: { id: 'd-1' }, error: null }));
    await expect(updateDestinationEmojiColor('g-1', 'd-1', { emoji: '📍', markerColor: null })).resolves.toBeUndefined();

    mockedSupabase.from.mockReturnValueOnce(query({ data: null, error: null }));
    await expect(updateDestinationEmojiColor('g-1', 'd-1', { emoji: null })).rejects.toMatchObject({ code: 'destination_emoji_update_empty' });

    const providerError = { code: '42501', message: 'permission denied' };
    mockedSupabase.from.mockReturnValueOnce(query({ data: null, error: providerError }));
    await expect(updateDestinationEmojiColor('g-1', 'd-1', { markerColor: '#E8543F' })).rejects.toMatchObject({ code: '42501', cause: providerError });
  });

  it('writes meet time through the legacy table path and omits an absent threshold', async () => {
    const update = query({ data: null, error: null });
    mockedSupabase.from.mockReturnValue(update);
    await expect(setDestinationMeetTime('d-1', null, 20)).resolves.toBeUndefined();
    expect(update.update).toHaveBeenCalledWith({ meet_at: null });
  });
});
