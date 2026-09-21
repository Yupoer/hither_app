import React from 'react';
import type { GroupState } from '../types';

const mockRecovery = jest.fn();
const mockReadSnapshot = jest.fn();
const mockGroupStateFromSnapshot = jest.fn();
const mockListOperations = jest.fn();
const mockHydrateVersions = jest.fn();
const mockFlushOutbox = jest.fn();
const mockSubscribeOutbox = jest.fn();

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('../api/client', () => ({
  getGroupRecoverySnapshot: (groupId: string) => mockRecovery(groupId),
}));

jest.mock('../api/supabase', () => ({
  supabase: {
    channel: jest.fn(() => ({
      on: jest.fn(function on(this: unknown) { return this; }),
      subscribe: jest.fn(function subscribe(this: unknown) { return this; }),
    })),
    removeChannel: jest.fn(),
  },
}));

jest.mock('../state/coreDataStore', () => ({
  groupStateFromCoreSnapshot: (snapshot: unknown) => mockGroupStateFromSnapshot(snapshot),
  readCoreSnapshot: (groupId: string) => mockReadSnapshot(groupId),
}));

jest.mock('../state/coreDataSync', () => ({
  flushCoreOperationOutbox: () => mockFlushOutbox(),
  hydrateCoreEntityVersions: (...args: unknown[]) => mockHydrateVersions(...args),
  listOpenCoreOperations: (groupId: string) => mockListOperations(groupId),
  projectOptimisticGathering: jest.fn(),
  projectPendingDestinations: (state: unknown) => state,
  subscribeCoreOutboxChanges: (listener: () => void) => mockSubscribeOutbox(listener),
}));

jest.mock('../state/energyObservability', () => ({
  energyObservability: { increment: jest.fn(), event: jest.fn() },
}));

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  create: (element: React.ReactElement) => {
    unmount: () => void;
    update: (next: React.ReactElement) => void;
  };
};
const { useGroupState } = require('../state/useGroupState') as typeof import('../state/useGroupState');

function state(name: string, groupId = 'group-1'): GroupState {
  return {
    group: { id: groupId, name, inviteCode: 'RACE01' } as GroupState['group'],
    members: [],
    destinations: [],
    subgroups: [],
  };
}

function snapshot(next: GroupState, revision: string) {
  return {
    state: next,
    generatedAt: revision,
    revision,
    entityVersions: {},
  };
}

describe('useGroupState recovery snapshot race', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockReadSnapshot.mockResolvedValue(null);
    mockGroupStateFromSnapshot.mockImplementation((value: { state?: GroupState }) => value.state);
    mockListOperations.mockResolvedValue([]);
    mockHydrateVersions.mockResolvedValue(undefined);
    mockFlushOutbox.mockResolvedValue(undefined);
    mockSubscribeOutbox.mockReturnValue(jest.fn());
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('exposes the real cold-start error and recovers without a local snapshot', async () => {
    mockRecovery.mockRejectedValue(new TypeError('Function is not a constructor'));
    let api!: ReturnType<typeof useGroupState>;
    function Harness() { api = useGroupState('group-1'); return null; }
    let root!: { unmount: () => void };
    await act(async () => { root = create(React.createElement(Harness)); });
    expect(api.state).toBeNull();
    expect(api.loadError?.kind).toBe('unknown');
    expect(api.emptyLocalSnapshot).toBe(true);
    let settle!: (value: ReturnType<typeof snapshot>) => void;
    mockRecovery.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
    await act(async () => { void api.refresh(); });
    expect(api.refreshing).toBe(true);
    const count = mockRecovery.mock.calls.length;
    await act(async () => { void api.refresh(); });
    expect(mockRecovery).toHaveBeenCalledTimes(count);
    await act(async () => { settle(snapshot(state('Recovered'), '2026-09-19T00:00:00.000Z')); });
    expect(api.state?.group.name).toBe('Recovered');
    expect(api.loadError).toBeNull();
    expect(api.refreshing).toBe(false);
    expect(api.emptyLocalSnapshot).toBe(false);
    await act(async () => root.unmount());
  });

  it('starts one immediate follow-up after a newer Realtime revision', async () => {
    const pending: Array<(value: ReturnType<typeof snapshot>) => void> = [];
    mockRecovery.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    let api!: ReturnType<typeof useGroupState>;
    function Harness() {
      api = useGroupState('group-1');
      return null;
    }

    let root!: { unmount: () => void };
    await act(async () => {
      root = create(React.createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockRecovery).toHaveBeenCalledTimes(1);

    const supabase = require('../api/supabase').supabase as {
      channel: jest.Mock;
    };
    const channel = supabase.channel.mock.results[0]?.value as {
      on: jest.Mock;
    };
    const realtimeCallback = channel.on.mock.calls[0]?.[2] as
      ((payload: { commit_timestamp: string }) => void);
    await act(async () => {
      realtimeCallback({ commit_timestamp: '2026-08-04T00:00:02.000Z' });
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(mockRecovery).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0]!(snapshot(state('old response'), '2026-08-04T00:00:01.000Z'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockRecovery).toHaveBeenCalledTimes(2);
    expect(api.state).toBeNull();

    await act(async () => {
      pending[1]!(snapshot(state('new response'), '2026-08-04T00:00:02.000Z'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state?.group.name).toBe('new response');
    expect(mockRecovery).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
  });

  it('does not apply a stale follow-up after switching groups', async () => {
    const pending: Array<(value: ReturnType<typeof snapshot>) => void> = [];
    mockRecovery.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    let api!: ReturnType<typeof useGroupState>;
    function Harness({ groupId }: { groupId: string }) {
      api = useGroupState(groupId);
      return null;
    }

    let root!: { unmount: () => void; update: (element: React.ReactElement) => void };
    await act(async () => {
      root = create(React.createElement(Harness, { groupId: 'group-1' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockRecovery).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.update(React.createElement(Harness, { groupId: 'group-2' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockRecovery).toHaveBeenCalledTimes(2);

    await act(async () => {
      pending[0]!(snapshot(state('old group'), '2026-08-04T00:00:01.000Z'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state).toBeNull();

    await act(async () => {
      pending[1]!(snapshot(state('new group'), '2026-08-04T00:00:03.000Z'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state?.group.name).toBe('new group');

    await act(async () => root.unmount());
  });

  it('does not apply a delayed local snapshot from the previous group', async () => {
    let resolveGroupOne!: (value: unknown) => void;
    let resolveGroupTwo!: (value: unknown) => void;
    mockReadSnapshot
      .mockImplementationOnce(() => new Promise((resolve) => { resolveGroupOne = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveGroupTwo = resolve; }))
      .mockResolvedValue(null);
    // Keep remote recovery pending so this test isolates the local SQLite race.
    mockRecovery.mockImplementation(() => new Promise(() => {}));

    let api!: ReturnType<typeof useGroupState>;
    function Harness({ groupId }: { groupId: string }) {
      api = useGroupState(groupId);
      return null;
    }

    let root!: { unmount: () => void; update: (element: React.ReactElement) => void };
    await act(async () => {
      root = create(React.createElement(Harness, { groupId: 'group-1' }));
      await Promise.resolve();
    });

    await act(async () => {
      root.update(React.createElement(Harness, { groupId: 'group-2' }));
      await Promise.resolve();
    });

    await act(async () => {
      resolveGroupOne({ state: state('stale local group one'), source: 'local_cache' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state).toBeNull();

    await act(async () => {
      resolveGroupTwo({ state: state('local group two'), source: 'local_cache' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state?.group.name).toBe('local group two');

    await act(async () => root.unmount());
  });

  it('keeps the new group loading through a late old-group response and rejects its old refresh', async () => {
    const pending: Array<{
      groupId: string;
      resolve: (value: ReturnType<typeof snapshot>) => void;
    }> = [];
    mockRecovery.mockImplementation((groupId: string) => new Promise(resolve => {
      pending.push({ groupId, resolve });
    }));

    let api!: ReturnType<typeof useGroupState>;
    function Harness({ groupId }: { groupId: string }) {
      api = useGroupState(groupId);
      return null;
    }

    let root!: { unmount: () => void; update: (element: React.ReactElement) => void };
    await act(async () => {
      root = create(React.createElement(Harness, { groupId: 'group-1' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pending.map(request => request.groupId)).toEqual(['group-1']);
    const oldRefresh = api.refresh;

    await act(async () => {
      root.update(React.createElement(Harness, { groupId: 'group-2' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state).toBeNull();
    expect(api.loading).toBe(true);
    expect(pending.map(request => request.groupId)).toEqual(['group-1', 'group-2']);

    await act(async () => {
      pending[0]!.resolve(snapshot(state('late old group'), '2026-09-19T00:00:01Z'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state).toBeNull();
    expect(api.loading).toBe(true);

    const recoveryCalls = mockRecovery.mock.calls.length;
    await act(async () => {
      await expect(oldRefresh('poll_manual_refresh')).resolves.toBe(false);
      await Promise.resolve();
    });
    expect(mockRecovery.mock.calls.length).toBe(recoveryCalls);

    await act(async () => {
      pending[1]!.resolve(snapshot(state('new group', 'group-2'), '2026-09-19T00:00:02Z'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state?.group.name).toBe('new group');
    expect(api.loading).toBe(false);

    await act(async () => root.unmount());
  });

  it('keeps the new actor loading through a late old-actor recovery error', async () => {
    const pending: Array<{
      resolve: (value: ReturnType<typeof snapshot>) => void;
      reject: (cause: Error) => void;
    }> = [];
    mockRecovery.mockImplementation((_groupId: string) => new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
    }));

    let api!: ReturnType<typeof useGroupState>;
    function Harness({ actor }: { actor: string }) {
      api = useGroupState('group-1', { myUserId: actor });
      return null;
    }

    let root!: { unmount: () => void; update: (element: React.ReactElement) => void };
    await act(async () => {
      root = create(React.createElement(Harness, { actor: 'actor-old' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pending).toHaveLength(1);

    await act(async () => {
      root.update(React.createElement(Harness, { actor: 'actor-new' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pending).toHaveLength(2);
    expect(api.state).toBeNull();
    expect(api.loading).toBe(true);

    await act(async () => {
      pending[0]!.reject(new Error('old actor request failed'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.error).toBeNull();
    expect(api.loading).toBe(true);

    await act(async () => {
      pending[1]!.resolve(snapshot(state('new actor'), '2026-09-19T00:00:03Z'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state?.group.name).toBe('new actor');
    expect(api.loading).toBe(false);

    await act(async () => root.unmount());
  });

  function withDestinations(name: string, destIds: string[]): GroupState {
    return {
      ...state(name),
      destinations: destIds.map(
        (id) =>
          ({
            id,
            title: id,
            coordinates: { latitude: 1, longitude: 2 },
            status: 'pending',
            order: 0,
            day: 1,
          }) as GroupState['destinations'][number],
      ),
      nextDestination: destIds[0]
        ? ({
            id: destIds[0],
            title: destIds[0],
            coordinates: { latitude: 1, longitude: 2 },
            status: 'pending',
            order: 0,
            day: 1,
          } as GroupState['nextDestination'])
        : undefined,
    };
  }

  it('persists fenced membership merge and does not schedule poll undo (#167)', async () => {
    const nonempty = withDestinations('local cards', ['a', 'b']);
    const emptyMembers = {
      ...withDestinations('empty remote', []),
      members: [
        {
          userId: 'me',
          name: 'Me',
          role: 'leader' as const,
          status: 'active' as const,
          coordinates: { latitude: 1, longitude: 2 },
          lastUpdated: 't1',
        },
        {
          userId: 'peer',
          name: 'Peer',
          role: 'follower' as const,
          status: 'active' as const,
          coordinates: { latitude: 3, longitude: 4 },
          lastUpdated: 't2',
        },
      ],
    };

    mockReadSnapshot.mockResolvedValue({
      state: nonempty,
      source: 'local_cache',
    });

    // Mount fires subscription_hydrate + foreground poll; keep both nonempty
    // until the test switches mode for membership fence cases.
    let mode: 'nonempty' | 'membership_empty' | 'itinerary_empty' = 'nonempty';
    let rev = 1;
    mockRecovery.mockImplementation(async () => {
      const sec = String(rev).padStart(2, '0');
      const revision = `2026-08-12T00:00:${sec}.000Z`;
      rev += 1;
      if (mode === 'membership_empty') return snapshot(emptyMembers, revision);
      if (mode === 'itinerary_empty') {
        return snapshot(withDestinations('cleared', []), revision);
      }
      return snapshot(nonempty, revision);
    });

    let api!: ReturnType<typeof useGroupState>;
    function Harness() {
      api = useGroupState('group-1', { myUserId: 'me' });
      return null;
    }

    let root!: { unmount: () => void };
    await act(async () => {
      root = create(React.createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.state?.destinations).toHaveLength(2);
    expect(mockHydrateVersions).toHaveBeenCalled();
    const afterHydrateCalls = mockHydrateVersions.mock.calls.length;
    const afterRecoveryCalls = mockRecovery.mock.calls.length;

    mode = 'membership_empty';
    await act(async () => {
      await api.refresh('membership_change');
      await Promise.resolve();
      await Promise.resolve();
    });

    // Fence keeps cards; hydrate receives the merged non-empty itinerary.
    expect(api.state?.destinations).toHaveLength(2);
    expect(api.state?.members).toHaveLength(2);
    expect(mockHydrateVersions.mock.calls.length).toBeGreaterThan(afterHydrateCalls);
    const lastHydrateArg = mockHydrateVersions.mock.calls[
      mockHydrateVersions.mock.calls.length - 1
    ]?.[1] as GroupState;
    expect(lastHydrateArg.destinations).toHaveLength(2);

    // No automatic poll follow-up that would undo the fence.
    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(mockRecovery.mock.calls.length).toBe(afterRecoveryCalls + 1);

    // Second consecutive membership-empty snapshot still fenced.
    await act(async () => {
      await api.refresh('membership_change');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state?.destinations).toHaveLength(2);
    const secondHydrate = mockHydrateVersions.mock.calls[
      mockHydrateVersions.mock.calls.length - 1
    ]?.[1] as GroupState;
    expect(secondHydrate.destinations).toHaveLength(2);

    // Itinerary-authoritative empty may clear cards.
    mode = 'itinerary_empty';
    await act(async () => {
      await api.refresh('itinerary_mutation');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state?.destinations).toHaveLength(0);
    const clearedHydrate = mockHydrateVersions.mock.calls[
      mockHydrateVersions.mock.calls.length - 1
    ]?.[1] as GroupState;
    expect(clearedHydrate.destinations).toHaveLength(0);

    await act(async () => root.unmount());
  });

  it('ignores stale out-of-order empty membership responses for paint and persist', async () => {
    const nonempty = withDestinations('cards', ['a']);
    const emptyRemote = withDestinations('empty', []);
    mockReadSnapshot.mockResolvedValue(null);
    const pending: Array<(value: ReturnType<typeof snapshot>) => void> = [];
    mockRecovery.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));

    let api!: ReturnType<typeof useGroupState>;
    function Harness() {
      api = useGroupState('group-1');
      return null;
    }

    let root!: { unmount: () => void };
    await act(async () => {
      root = create(React.createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });
    // subscription_hydrate + foreground poll may both start; settle any in-flight.
    const initialPending = pending.length;
    expect(initialPending).toBeGreaterThanOrEqual(1);

    await act(async () => {
      // Apply newest nonempty first among initial requests.
      for (let i = 0; i < initialPending; i += 1) {
        pending[i]!(snapshot(nonempty, `2026-08-12T00:00:0${i + 2}.000Z`));
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state?.destinations).toHaveLength(1);

    // Queue a membership load, then resolve it with a stale empty revision.
    const before = pending.length;
    await act(async () => {
      void api.refresh('membership_change');
      await Promise.resolve();
    });
    // Either starts immediately or coalesces; wait until a new pending slot exists.
    await act(async () => {
      jest.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pending.length).toBeGreaterThan(before);

    const hydrateBeforeStale = mockHydrateVersions.mock.calls.length;
    await act(async () => {
      // Older empty revision must not overwrite newer paint/persist.
      pending[pending.length - 1]!(
        snapshot(emptyRemote, '2026-08-12T00:00:01.000Z'),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.state?.destinations).toHaveLength(1);
    const hydratesAfter = mockHydrateVersions.mock.calls.slice(hydrateBeforeStale);
    for (const call of hydratesAfter) {
      const arg = call[1] as GroupState | undefined;
      if (arg) expect(arg.destinations.length).toBeGreaterThan(0);
    }

    await act(async () => root.unmount());
  });

  it('coalesces non-location realtime events, polls without overlap and sleeps in background', async () => {
    mockRecovery.mockResolvedValue(snapshot(state('server'), '2026-09-19T00:00:00Z'));
    function Harness() { useGroupState('group-1'); return null; }
    let root!: { unmount: () => void };
    await act(async () => { root = create(React.createElement(Harness)); });
    const { supabase } = require('../api/supabase');
    const channel = supabase.channel.mock.results[0].value;
    const subscribed = channel.subscribe.mock.calls[0][0];
    await act(async () => { subscribed('SUBSCRIBED'); });
    const before = mockRecovery.mock.calls.length;
    await act(async () => {
      for (const call of channel.on.mock.calls.slice(1)) call[2]({ commit_timestamp: '2026-09-19T00:00:01Z' });
      await jest.advanceTimersByTimeAsync(300);
    });
    expect(mockRecovery.mock.calls.length).toBe(before + 1);
    // Return a current revision so reconciliation settles after a new event.
    mockRecovery.mockResolvedValue(snapshot(state('fresh'), '2026-09-19T00:00:01Z'));
    await act(async () => { subscribed('CHANNEL_ERROR'); await jest.advanceTimersByTimeAsync(60_000); });
    expect(mockRecovery.mock.calls.length).toBeGreaterThan(before + 1);
    const { AppState } = require('react-native');
    await act(async () => { AppState.addEventListener.mock.calls[0][1]('background'); });
    const backgroundCalls = mockRecovery.mock.calls.length;
    await act(async () => { await jest.advanceTimersByTimeAsync(900_000); });
    expect(mockRecovery.mock.calls.length).toBe(backgroundCalls);
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
    await act(async () => root.unmount());
  });

  it('retains a saved receipt on queue read failure and isolates a subsequent account', async () => {
    const own = { id: 'op1', actorId: 'me', groupId: 'group-1', payload: {}, status: 'pending', operationType: 'add_destination' };
    mockListOperations.mockResolvedValue([own, { ...own, id: 'other-op', actorId: 'other' }]);
    mockRecovery.mockResolvedValue(snapshot(state('server'), '2026-09-19T00:00:00Z'));
    let api!: ReturnType<typeof useGroupState>;
    function Harness({ actor }: { actor: string }) { api = useGroupState('group-1', { myUserId: actor }); return null; }
    let root!: { unmount: () => void; update: (element: React.ReactElement) => void };
    await act(async () => { root = create(React.createElement(Harness, { actor: 'me' })); });
    expect(api.openOperations.map(op => op.id)).toEqual(['op1']);
    mockListOperations.mockRejectedValue(new Error('SQLite disk full'));
    await act(async () => { mockSubscribeOutbox.mock.calls[0][0](); });
    expect(api.openOperations.map(op => op.id)).toEqual(['op1']);
    expect(api.error).toBeTruthy();
    mockListOperations.mockResolvedValue([]);
    await act(async () => { root.update(React.createElement(Harness, { actor: 'other' })); });
    expect(api.openOperations).toEqual([]);
    await act(async () => root.unmount());
  });

  it('paints a committed local destination while remote recovery is still pending', async () => {
    mockRecovery.mockImplementation(() => new Promise(() => {}));
    const local = { ...state('local'), destinations: [{ id: 'local-point', title: 'saved locally',
      coordinates: { latitude: 25, longitude: 121 }, order: 0, day: null }] };
    let api!: ReturnType<typeof useGroupState>;
    function Harness() { api = useGroupState('group-1', { myUserId: 'me' }); return null; }
    let root!: { unmount: () => void };
    await act(async () => { root = create(React.createElement(Harness)); });
    mockReadSnapshot.mockResolvedValue({ state: local, source: 'local_optimistic', syncedAt: Date.now() });
    await act(async () => { mockSubscribeOutbox.mock.calls[0][0](); });
    expect(api.state?.destinations[0].id).toBe('local-point');
    await act(async () => root.unmount());
  });

  it('shows cached state offline but clears it when membership was revoked', async () => {
    mockReadSnapshot.mockResolvedValue({ state: state('cached'), source: 'local_cache', syncedAt: Date.now() });
    mockRecovery.mockRejectedValue(new Error('Network request failed'));
    let api!: ReturnType<typeof useGroupState>;
    function Harness() { api = useGroupState('group-1'); return null; }
    let root!: { unmount: () => void };
    await act(async () => { root = create(React.createElement(Harness)); });
    expect(api.state?.group.name).toBe('cached');
    expect(api.dataSource).toBe('local_cache');
    expect(api.error).toBeNull();
    mockRecovery.mockRejectedValue(new Error('not_member'));
    await act(async () => { expect(await api.refresh()).toBe(false); });
    expect(api.state).toBeNull();
    expect(api.error).toBe('not_member');
    await act(async () => root.unmount());
  });
});
