jest.mock('../api/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

const mockIsDemoGroup = jest.fn(() => false);
const mockDemoAddDestination = jest.fn(() => 'demo-destination');
const mockDemoAddDestinationsBatch = jest.fn();
const mockDemoUpdateDestinationEmoji = jest.fn();
jest.mock('../api/demo', () => ({
  isDemoGroup: mockIsDemoGroup,
  demoAddDestination: mockDemoAddDestination,
  demoAddDestinationsBatch: mockDemoAddDestinationsBatch,
  demoUpdateDestinationEmoji: mockDemoUpdateDestinationEmoji,
}));

const coreMissing = () => Object.assign(new Error('no local snapshot'), { code: 'core_snapshot_missing' });
const mockCoreSync = {
  ensureCoreSnapshot: jest.fn(),
  enqueueDestinationAdd: jest.fn(),
  enqueueDestinationDelete: jest.fn(),
  enqueueDestinationComplete: jest.fn(),
  enqueueDestinationReorder: jest.fn(),
  enqueueDestinationEdit: jest.fn(),
  enqueueDestinationMeetTime: jest.fn(),
};
jest.mock('../state/coreDataSync', () => mockCoreSync);

import { supabase } from '../api/supabase';
import {
  addDestination,
  addDestinationsBatch,
  completeGatheringStop,
  deleteDestination,
  getKmlImportQuota,
  mapDestination,
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
  mockIsDemoGroup.mockReturnValue(false);
  mockCoreSync.ensureCoreSnapshot.mockResolvedValue({ groupId: 'g-1' });
  for (const [name, method] of Object.entries(mockCoreSync)) {
    if (name !== 'ensureCoreSnapshot') method.mockResolvedValue(undefined);
  }
});

describe('DestinationService mapping and durable boundaries', () => {
  it('maps itinerary rows and normalizes accommodation/default fields', () => {
    expect(mapDestination({
      id: 'd-1', title: 'Hotel', position: 2, day: 1, address: null,
      latitude: 25, longitude: 121, meet_at: null, meet_red_minutes: 5,
      subgroup_id: 'sg', closed_at: 'closed', closed_by_session_id: 'session',
      emoji: '🏨', marker_color: '#596DDE', kind: 'accommodation', stay_anchor: 1 as any,
      provider_place_id: 'provider-1',
    })).toMatchObject({
      id: 'd-1', order: 2, kind: 'accommodation', stayAnchor: true,
      coordinates: { latitude: 25, longitude: 121 }, providerPlaceId: 'provider-1',
    });
    expect(mapDestination({
      id: 'd-2', title: 'Stop', position: 0, day: null, address: null,
      latitude: null as any, longitude: null as any,
    })).toMatchObject({ kind: 'stop', stayAnchor: false, coordinates: { latitude: 0, longitude: 0 } });
  });

  it('queues a destination when a local snapshot is available', async () => {
    mockCoreSync.enqueueDestinationAdd.mockResolvedValue({ destinationId: 'queued-1' });
    await expect(addDestination('g-1', {
      title: 'Stay', address: 'A', coordinates: { latitude: 1, longitude: 2 },
      day: 0, kind: 'accommodation', providerPlaceId: 'place-1',
    }, 'sg-1')).resolves.toBe('queued-1');
    expect(mockCoreSync.enqueueDestinationAdd).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'g-1', day: 1, kind: 'accommodation', stayAnchor: false,
      providerPlaceId: 'place-1', subgroupId: 'sg-1',
    }));
    expect(mockedSupabase.rpc).not.toHaveBeenCalled();
  });

  it('keeps durable enqueue failures visible instead of silently dispatching a remote mutation', async () => {
    const failure = Object.assign(new Error('queue unavailable'), { code: 'queue_unavailable' });
    mockCoreSync.enqueueDestinationAdd.mockRejectedValueOnce(failure);
    await expect(addDestination('g-1', {
      title: 'Stop', coordinates: { latitude: 1, longitude: 2 }, day: 3,
    })).rejects.toBe(failure);
    expect(mockedSupabase.rpc).not.toHaveBeenCalled();
  });

  it('keeps demo operations local and does not contact Supabase', async () => {
    mockIsDemoGroup.mockReturnValue(true);
    await expect(addDestination('demo', { title: 'Demo', coordinates: { latitude: 1, longitude: 2 } })).resolves.toBe('demo-destination');
    await expect(addDestinationsBatch('demo', [{ title: 'A', latitude: 1, longitude: 2 }])).resolves.toBeUndefined();
    await expect(deleteDestination('demo', 'd')).resolves.toBeUndefined();
    await expect(completeGatheringStop('demo', 'd')).resolves.toBeUndefined();
    await expect(reorderDestinations('demo', [{ id: 'd', position: 0, day: null }])).resolves.toBeUndefined();
    await expect(updateDestinationEmojiColor('demo', 'd', { emoji: '📍', markerColor: '#E8543F' })).resolves.toBeUndefined();
    expect(mockDemoAddDestination).toHaveBeenCalled();
    expect(mockDemoAddDestinationsBatch).toHaveBeenCalled();
    expect(mockDemoUpdateDestinationEmoji).toHaveBeenCalledWith('d', '📍', '#E8543F');
    expect(mockedSupabase.rpc).not.toHaveBeenCalled();
  });

  it('handles quota, empty batch, and durable delete/complete/reorder operations', async () => {
    mockedSupabase.rpc.mockResolvedValueOnce({ data: 4, error: null });
    await expect(getKmlImportQuota()).resolves.toBe(4);
    mockedSupabase.rpc.mockResolvedValueOnce({ data: Number.NaN, error: null });
    await expect(getKmlImportQuota()).resolves.toBe(0);

    await expect(addDestinationsBatch('g-1', [])).resolves.toBeUndefined();
    await expect(deleteDestination('g-1', 'd-1')).resolves.toBeUndefined();
    await expect(completeGatheringStop('g-1', 'd-1')).resolves.toBeUndefined();
    await expect(reorderDestinations('g-1', [{ id: 'd-1', position: 1, day: 2, meetAt: 't', stayAnchor: true }])).resolves.toBeUndefined();
    expect(mockedSupabase.rpc).toHaveBeenCalledTimes(2);
  });

  it('surfaces a missing local snapshot before a durable delete', async () => {
    mockCoreSync.ensureCoreSnapshot.mockResolvedValueOnce(null);
    await expect(deleteDestination('g-1', 'd-1')).rejects.toMatchObject({ code: 'core_snapshot_missing' });
    expect(mockedSupabase.rpc).not.toHaveBeenCalled();
  });

  it('validates emoji/color at the service boundary and persists valid patches', async () => {
    await expect(updateDestinationEmojiColor('g-1', 'd-1', { emoji: 'not-emoji' })).rejects.toMatchObject({ code: 'invalid_destination_emoji' });
    await expect(updateDestinationEmojiColor('g-1', 'd-1', { markerColor: '#000000' })).rejects.toMatchObject({ code: 'invalid_destination_color' });
    await expect(updateDestinationEmojiColor('g-1', 'd-1', {})).resolves.toBeUndefined();

    await expect(updateDestinationEmojiColor('g-1', 'd-1', { emoji: '📍', markerColor: null })).resolves.toBeUndefined();
    expect(mockCoreSync.enqueueDestinationEdit).toHaveBeenCalledWith(expect.objectContaining({
      patch: { emoji: '📍', markerColor: null },
    }));

    mockCoreSync.ensureCoreSnapshot.mockResolvedValueOnce(null);
    await expect(updateDestinationEmojiColor('g-1', 'd-1', { emoji: null })).rejects.toMatchObject({ code: 'core_snapshot_missing' });
  });

  it('queues and falls back for meet time while preserving the optional threshold', async () => {
    await expect(setDestinationMeetTime('d-1', '2026-09-19T10:00:00Z', 15, 'g-1')).resolves.toBeUndefined();
    expect(mockCoreSync.enqueueDestinationMeetTime).toHaveBeenCalledWith({
      destinationId: 'd-1', groupId: 'g-1', meetAt: '2026-09-19T10:00:00Z', meetRedMinutes: 15,
    });

    // Without a group id the service intentionally uses the legacy table path.
    const update = query({ data: null, error: null });
    mockedSupabase.from.mockReturnValue(update);
    await expect(setDestinationMeetTime('d-1', null, 20)).resolves.toBeUndefined();
    expect(update.update).toHaveBeenCalledWith({ meet_at: null });
  });
});
