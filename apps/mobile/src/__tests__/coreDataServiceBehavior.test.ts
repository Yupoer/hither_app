jest.mock('../api/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

import { supabase } from '../api/supabase';
import { applyCoreOperation, fetchCoreEntityVersions } from '../api/services/CoreDataService';
import type { CoreOperation } from '../types/coreData';

const mockedSupabase = supabase as unknown as {
  auth: { getSession: jest.Mock };
  rpc: jest.Mock;
  from: jest.Mock;
};

const operation = (overrides: Partial<CoreOperation> = {}): CoreOperation => ({
  id: 'op-1',
  groupId: 'group-1',
  entityId: 'destination-1',
  entityType: 'itinerary',
  entityVersion: 4,
  operationType: 'edit_destination',
  payload: { title: 'New title' },
  status: 'pending',
  attempts: 0,
  nextAttemptAt: 0,
  conflictResult: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

const responseBuilder = (result: unknown) => {
  const builder: any = {};
  for (const method of ['select', 'eq']) builder[method] = jest.fn(() => builder);
  builder.single = jest.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedSupabase.auth.getSession.mockResolvedValue({
    data: { session: { access_token: 'token', user: { id: 'actor-1' } } },
    error: null,
  });
});

describe('CoreDataService remote operation adapter', () => {
  it('applies actor-bound operations and maps accepted, duplicate, and conflict responses', async () => {
    const actorOp = operation({ actorId: 'actor-1' });
    mockedSupabase.rpc
      .mockResolvedValueOnce({ data: { status: 'accepted', operation_id: 'server-op', entity_version: 5, entity: { id: 'd' }, effects: { changed: true } }, error: null })
      .mockResolvedValueOnce({ data: [{ status: 'duplicate', operation_id: 'server-op', entity_version: 5 }], error: null })
      .mockResolvedValueOnce({ data: { status: 'conflict', operation_id: 'server-op', conflict: { code: 'stale_version', message: 'stale', server_entity_version: 7, server_state: { title: 'server' } } }, error: null });

    await expect(applyCoreOperation(actorOp)).resolves.toMatchObject({
      status: 'accepted', operationId: 'server-op', entityVersion: 5,
      entity: { id: 'd' }, effects: { changed: true },
    });
    await expect(applyCoreOperation(actorOp)).resolves.toMatchObject({
      status: 'duplicate', entityVersion: 5,
    });
    await expect(applyCoreOperation(actorOp)).resolves.toMatchObject({
      status: 'conflict',
      conflict: { code: 'stale_version', serverEntityVersion: 7, operationId: 'op-1' },
    });
    expect(mockedSupabase.rpc).toHaveBeenNthCalledWith(1, 'apply_core_operation_v2', expect.objectContaining({
      p_actor_id: 'actor-1', p_sequence: 0, p_dependency_ids: [],
    }));
  });

  it('fails closed for missing or changed local actors before the actor RPC', async () => {
    const actorOp = operation({ actorId: 'actor-1' });
    mockedSupabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(applyCoreOperation(actorOp)).rejects.toMatchObject({
      code: 'session_missing_or_expired',
    });
    mockedSupabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'token', user: { id: 'other-actor' } } },
      error: null,
    });
    await expect(applyCoreOperation(actorOp)).resolves.toMatchObject({
      status: 'conflict', conflict: { code: 'account_changed' },
    });
    expect(mockedSupabase.rpc).not.toHaveBeenCalled();
  });

  it('maps every supported server conflict code and unknown codes to unknown', async () => {
    const codes = ['stale_version', 'invalid_transition', 'unauthorized', 'validation', 'dependency_missing', 'account_changed', 'other'];
    mockedSupabase.rpc.mockImplementation(async () => ({
      data: { status: 'conflict', conflict: { code: codes.shift(), message: 'conflict' } },
      error: null,
    }));
    const actorOp = operation({ actorId: 'actor-1' });
    for (const expected of ['stale_version', 'invalid_transition', 'unauthorized', 'validation', 'dependency_missing', 'account_changed', 'unknown']) {
      await expect(applyCoreOperation(actorOp)).resolves.toMatchObject({ status: 'conflict', conflict: { code: expected } });
    }
  });

  it('handles legacy arrival operations and maps auth failures to conflicts', async () => {
    const arrival = operation({
      operationType: 'record_arrival',
      entityId: 'destination-1',
      payload: { actorId: 'actor-1', userId: 'actor-1', arrived: true, arrivedAt: '2026-09-19T01:00:00Z' },
    });
    mockedSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    mockedSupabase.from.mockReturnValue(responseBuilder({ data: { closed_at: '2026-09-19T01:01:00Z' }, error: null }));
    await expect(applyCoreOperation(arrival)).resolves.toMatchObject({
      status: 'accepted', entity: { completeSolo: true },
    });

    mockedSupabase.rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'permission denied' } });
    await expect(applyCoreOperation(arrival)).resolves.toMatchObject({
      status: 'conflict', conflict: { code: 'unauthorized' },
    });
    mockedSupabase.rpc.mockResolvedValueOnce({ error: { code: 'PGRST116', message: 'not found' } });
    await expect(applyCoreOperation(arrival)).resolves.toMatchObject({ status: 'conflict' });
  });

  it('uses the leader RPC for gathering switches and the generic RPC for other legacy operations', async () => {
    const switchOp = operation({ operationType: 'switch_gathering', payload: { activeDestinationId: 'd-2' } });
    mockedSupabase.rpc.mockResolvedValueOnce({ data: [{ status: 'accepted' }], error: null });
    await expect(applyCoreOperation(switchOp)).resolves.toMatchObject({ status: 'accepted', operationId: 'op-1', entityVersion: 5 });
    expect(mockedSupabase.rpc).toHaveBeenLastCalledWith('apply_leader_gathering_switch', expect.objectContaining({ p_destination_id: 'd-2' }));

    const generic = operation({ operationType: 'set_navigation_response', entityType: 'navigation_response' });
    mockedSupabase.rpc.mockResolvedValueOnce({ data: { status: 'duplicate' }, error: null });
    await expect(applyCoreOperation(generic)).resolves.toMatchObject({ status: 'duplicate', entityVersion: 4 });
    expect(mockedSupabase.rpc).toHaveBeenLastCalledWith('apply_core_operation', expect.objectContaining({ p_operation_type: 'set_navigation_response' }));

    mockedSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(applyCoreOperation(generic)).rejects.toThrow('empty result');
  });

  it('rethrows non-auth arrival failures instead of misclassifying them', async () => {
    const arrival = operation({
      operationType: 'record_arrival',
      payload: { actorId: 'actor-1', userId: 'actor-1', arrived: false, arrivedAt: '2026-09-19T01:00:00Z' },
    });
    mockedSupabase.rpc.mockResolvedValueOnce({ error: { code: '57014', message: 'statement timeout' } });
    await expect(applyCoreOperation(arrival)).rejects.toMatchObject({ code: '57014', cause: expect.anything() });
  });

  it('loads authoritative entity versions through the typed mapper', async () => {
    mockedSupabase.from.mockReturnValue(responseBuilder({
      data: [{ group_id: 'group-1', entity_type: 'itinerary', entity_id: 'd-1', entity_version: 8, state: { title: 'A' } }],
      error: null,
    }));
    await expect(fetchCoreEntityVersions('group-1')).resolves.toEqual([{
      groupId: 'group-1', entityType: 'itinerary', entityId: 'd-1', entityVersion: 8, state: { title: 'A' },
    }]);
  });
});
