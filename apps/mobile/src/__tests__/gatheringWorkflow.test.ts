import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Destination, DestinationArrival, GatherPointRequest } from '../types';
import type { CoreOperation } from '../types/coreData';

type Handler = (payload: { eventType: string; new: Record<string, unknown> | null }) => void;
const mockChannels: { name: string; handlers: Record<string, Handler>; subscribed?: (s: string) => void }[] = [];
const mockRemoved: unknown[] = [];
const mockAlert = jest.fn();
const mockFetchArrivals = jest.fn(async (): Promise<DestinationArrival[]> => []);
const mockFetchRequests = jest.fn(async (): Promise<GatherPointRequest[]> => []);
const mockRemoveArrival = jest.fn(async (_id: string) => undefined);

jest.mock('react-native', () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));
jest.mock('../api/client', () => ({
  fetchDestinationArrivals: () => mockFetchArrivals(),
  fetchPendingGatherPointRequests: () => mockFetchRequests(),
}));
jest.mock('../api/demo', () => ({ isDemoGroup: (id: string | null) => id === 'demo' }));
jest.mock('../api/supabase', () => ({
  supabase: {
    channel: (name: string) => {
      const entry: (typeof mockChannels)[number] = { name, handlers: {} };
      mockChannels.push(entry);
      const builder = {
        on: (_event: string, filter: { table: string }, handler: Handler) => {
          entry.handlers[filter.table] = handler;
          return builder;
        },
        subscribe: (callback: (status: string) => void) => {
          entry.subscribed = callback;
          return builder;
        },
      };
      return builder;
    },
    removeChannel: (channel: unknown) => { mockRemoved.push(channel); },
  },
}));
jest.mock('../state/coreDataSync', () => ({
  getCoreOperationOutbox: () => ({ removeArrival: mockRemoveArrival }),
}));
jest.mock('../state/useForegroundReconcile', () => ({ useForegroundReconcile: jest.fn(() => null) }));

import { useGatheringWorkflow, type UseGatheringWorkflowInput } from '../screens/MapScreen/hooks/useGatheringWorkflow';
import { projectArrivals } from '../state/arrivalSync';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const request = (id: string, subgroupId?: string) => ({ id, subgroupId }) as GatherPointRequest;

describe('useGatheringWorkflow', () => {
  let workflow: ReturnType<typeof useGatheringWorkflow> | undefined;
  let renderer: ReactTestRenderer | undefined;

  function input(overrides: Partial<UseGatheringWorkflowInput> = {}): UseGatheringWorkflowInput {
    return {
      groupId: 'g1',
      userId: 'leader',
      myScopeId: undefined,
      isMainLeader: true,
      isSubgroupLeader: false,
      canEditItinerary: true,
      t: (key) => key,
      arrivalOperations: [],
      arrivalSessionScope: [],
      rawDestinations: [],
      ...overrides,
    };
  }
  function Harness({ props }: { props: UseGatheringWorkflowInput }) {
    workflow = useGatheringWorkflow(props);
    return workflow.lifecycle;
  }
  async function render(props: UseGatheringWorkflowInput) {
    await act(async () => {
      if (renderer) renderer.update(React.createElement(Harness, { props }));
      else renderer = create(React.createElement(Harness, { props }));
    });
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockChannels.length = 0;
    mockRemoved.length = 0;
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    jest.useRealTimers();
  });

  it('shows a main leader only main-team requests, and a subgroup leader only its own', async () => {
    mockFetchRequests.mockResolvedValue([request('main'), request('sub', 's1'), request('other', 's2')]);
    await render(input());
    expect(workflow?.gatherPointRequests.map((row) => row.id)).toEqual(['main']);
    await act(async () => renderer?.unmount());
    renderer = undefined;
    await render(input({ isMainLeader: false, isSubgroupLeader: true, myScopeId: 's1' }));
    expect(workflow?.gatherPointRequests.map((row) => row.id)).toEqual(['sub']);
  });

  it('never fetches requests for a member who cannot edit the itinerary', async () => {
    await render(input({ isMainLeader: false, canEditItinerary: false }));
    expect(mockFetchArrivals).toHaveBeenCalled();
    expect(mockFetchRequests).not.toHaveBeenCalled();
  });

  it('coalesces a Realtime burst into one reload and keeps one channel across translator changes', async () => {
    await render(input());
    expect(mockChannels).toHaveLength(1);
    expect(mockFetchArrivals).toHaveBeenCalledTimes(1);
    const arrivals = mockChannels[0].handlers.destination_arrivals;
    act(() => {
      for (let i = 0; i < 5; i++) arrivals({ eventType: 'INSERT', new: {} });
    });
    await act(async () => { jest.advanceTimersByTime(3_000); });
    expect(mockFetchArrivals).toHaveBeenCalledTimes(2);
    await render(input({ t: (key) => `new:${key}` }));
    expect(mockChannels).toHaveLength(1);
  });

  it('uses a fresh channel name per subscription and removes the old one', async () => {
    await render(input());
    await render(input({ groupId: 'g2' }));
    expect(mockChannels.map((channel) => channel.name)).toHaveLength(2);
    expect(new Set(mockChannels.map((channel) => channel.name)).size).toBe(2);
    expect(mockRemoved).toHaveLength(1);
  });

  it('alerts a leader about a new request in their own scope from someone else', async () => {
    await render(input());
    const requests = mockChannels[0].handlers.gather_point_requests;
    act(() => requests({ eventType: 'INSERT', new: { requester_id: 'leader', subgroup_id: null } }));
    act(() => requests({ eventType: 'INSERT', new: { requester_id: 'member', subgroup_id: 's9' } }));
    act(() => requests({ eventType: 'UPDATE', new: { requester_id: 'member', subgroup_id: null } }));
    expect(mockAlert).not.toHaveBeenCalled();
    act(() => requests({ eventType: 'INSERT', new: { requester_id: 'member', subgroup_id: null } }));
    expect(mockAlert).toHaveBeenCalledWith('gatherRequest.newTitle', 'gatherRequest.newBody');
  });

  it('optimistically patches an arrival row until the next load', async () => {
    await render(input());
    act(() => workflow?.patchLocalArrival('d1', 'u2', true, '2026-11-01T00:00:00Z', 'session-1'));
    expect(workflow?.remoteArrivals).toEqual([expect.objectContaining({
      destinationId: 'd1', userId: 'u2', arrivedAt: '2026-11-01T00:00:00Z', navigationSessionId: 'session-1',
    })]);
    act(() => workflow?.patchLocalArrival('d1', 'u2', false));
    expect(workflow?.remoteArrivals).toEqual([]);
  });

  it('compacts my acked arrival receipt once the server row reflects it, but keeps an active-session undo', async () => {
    mockFetchArrivals.mockResolvedValue([
      { id: 'r1', destinationId: 'd1', userId: 'leader', navigationSessionId: 's1' } as DestinationArrival,
    ]);
    const op = (id: string, payload: Record<string, unknown>) => ({
      id, entityId: 'd1', operationType: 'record_arrival', status: 'acked', actorId: 'leader', createdAt: 1,
      payload: { actorId: 'leader', userId: 'leader', navigationSessionId: 's1', ...payload },
    }) as unknown as CoreOperation;
    await render(input({
      arrivalOperations: [op('arrive', { arrived: true })],
      rawDestinations: [] as Destination[],
    }));
    expect(mockRemoveArrival).toHaveBeenCalledWith('arrive');

    await act(async () => renderer?.unmount());
    renderer = undefined;
    mockRemoveArrival.mockClear();
    mockFetchArrivals.mockResolvedValue([]);
    const undo = op('undo', { arrived: false });
    await render(input({ arrivalOperations: [undo], arrivalSessionScope: ['s1'] }));
    expect(mockRemoveArrival).not.toHaveBeenCalled();
    await render(input({ arrivalOperations: [undo], arrivalSessionScope: [] }));
    expect(mockRemoveArrival).toHaveBeenCalledWith('undo');
  });

  it.each(['forward-clock', 'backward-clock', 'legacy-without-sequence'])('retires a superseded undo after re-entry is acknowledged with %s ordering', async (ordering) => {
    const operation = (id: string, sequence: number, arrived: boolean, occurredAt: string): CoreOperation => ({
      id, groupId: 'g1', entityId: 'd1', entityType: 'itinerary', entityVersion: 0,
      operationType: 'record_arrival', status: 'acked', actorId: 'leader',
      sequence: ordering === 'legacy-without-sequence' ? undefined : sequence,
      createdAt: sequence, updatedAt: sequence, attempts: 1, nextAttemptAt: 0, conflictResult: null,
      payload: { actorId: 'leader', userId: 'leader', navigationSessionId: 's1', arrived,
        arrivedAt: arrived ? occurredAt : null, occurredAt },
    });
    const undo = operation('undo', 2, false, '2026-10-22T00:00:02Z');
    const reentry = operation('reentry', 3, true,
      ordering === 'backward-clock' ? '2026-10-22T00:00:01Z' : '2026-10-22T00:00:05Z');
    const remote: DestinationArrival[] = [{ id: 'r1', groupId: 'g1', destinationId: 'd1', userId: 'leader',
      navigationSessionId: 's1', arrivedAt: String(reentry.payload.arrivedAt), source: 'automatic', markedBy: 'leader' }];
    mockFetchArrivals.mockResolvedValue(remote);
    await render(input({ arrivalOperations: [reentry, undo], arrivalSessionScope: ['s1'] }));
    expect(mockRemoveArrival).toHaveBeenCalledWith('undo');
    expect(mockRemoveArrival).not.toHaveBeenCalledWith('reentry');
    await render(input({ arrivalOperations: [reentry, undo], arrivalSessionScope: ['s1'] }));
    expect(mockRemoveArrival).not.toHaveBeenCalledWith('reentry');
    expect(projectArrivals(remote, [reentry, undo], 'leader', 's1')).toEqual([
      expect.objectContaining({ destinationId: 'd1', userId: 'leader', navigationSessionId: 's1', arrivedAt: reentry.payload.arrivedAt }),
    ]);
    await render(input({ arrivalOperations: [reentry], arrivalSessionScope: ['s1'] }));
    expect(mockRemoveArrival).toHaveBeenCalledWith('reentry');
    const retained = [undo, reentry].filter(op => !mockRemoveArrival.mock.calls.some(([id]) => id === op.id));
    expect(projectArrivals(remote, retained, 'leader', 's1')).toEqual(remote);
  });

  it.each(['pending', 'failed', 'other-session', 'other-actor', 'actor-mismatch'])('keeps the active undo when the newer arrival is %s', async (variant) => {
    const undo: CoreOperation = {
      id: 'undo', groupId: 'g1', entityId: 'd1', entityType: 'itinerary', entityVersion: 0,
      operationType: 'record_arrival', status: 'acked', actorId: 'leader', sequence: 2,
      createdAt: 2, updatedAt: 2, attempts: 1, nextAttemptAt: 0, conflictResult: null,
      payload: { actorId: 'leader', userId: 'leader', navigationSessionId: 's1', arrived: false },
    };
    const reentry: CoreOperation = { ...undo, id: 'reentry', sequence: 3, createdAt: 3,
      status: variant === 'pending' || variant === 'failed' ? variant : 'acked',
      actorId: variant === 'other-actor' || variant === 'actor-mismatch' ? 'other' : 'leader',
      payload: { ...undo.payload, arrived: true,
        actorId: variant === 'other-actor' ? 'other' : 'leader',
        navigationSessionId: variant === 'other-session' ? 's2' : 's1' },
    };
    mockFetchArrivals.mockResolvedValue([]);
    await render(input({ arrivalOperations: [reentry, undo], arrivalSessionScope: ['s1'] }));
    expect(mockRemoveArrival).not.toHaveBeenCalledWith('undo');
  });
});
