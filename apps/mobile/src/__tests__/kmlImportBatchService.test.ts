/**
 * @jest-environment node
 */
jest.mock('../api/supabase', () => {
  const rpc = jest.fn();
  return {
    supabase: {
      rpc,
      from: jest.fn(),
      auth: { getSession: jest.fn() },
    },
  };
});

jest.mock('../api/demo', () => ({
  isDemoGroup: () => false,
  demoAddDestination: jest.fn(),
  demoAddDestinationsBatch: jest.fn(),
  demoUpdateDestinationEmoji: jest.fn(),
}));

import { supabase } from '../api/supabase';
import { addDestinationsBatch } from '../api/services/DestinationService';
import { KmlImportError } from '../utils/kmlBatch';

const mockedRpc = supabase.rpc as jest.Mock;

describe('addDestinationsBatch', () => {
  beforeEach(() => {
    mockedRpc.mockReset();
  });

  it('calls import_itinerary_batch once with ordered payload', async () => {
    mockedRpc.mockResolvedValue({ data: 2, error: null });
    await addDestinationsBatch(
      'g1',
      [
        { title: 'A', latitude: 1, longitude: 2 },
        { title: 'B', latitude: 3, longitude: 4 },
      ],
      { day: 2, subgroupId: 'sg' },
    );
    expect(mockedRpc).toHaveBeenCalledTimes(1);
    expect(mockedRpc).toHaveBeenCalledWith('import_itinerary_batch', {
      p_group_id: 'g1',
      p_subgroup_id: 'sg',
      p_day: 2,
      p_items: [
        { title: 'A', latitude: 1, longitude: 2, address: null },
        { title: 'B', latitude: 3, longitude: 4, address: null },
      ],
    });
  });

  it('maps permission errors to KmlImportError permission stage', async () => {
    mockedRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'leader membership required' },
    });
    await expect(
      addDestinationsBatch('g1', [{ title: 'A', latitude: 1, longitude: 2 }]),
    ).rejects.toMatchObject({ stage: 'permission' });
  });

  it('maps write failures to persistence, not parse', async () => {
    mockedRpc.mockResolvedValue({
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    });
    try {
      await addDestinationsBatch('g1', [{ title: 'A', latitude: 1, longitude: 2 }]);
      throw new Error('expected');
    } catch (e) {
      expect(e).toBeInstanceOf(KmlImportError);
      expect((e as KmlImportError).stage).toBe('persistence');
    }
  });
});
