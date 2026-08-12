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
  subscribeCoreOutboxChanges: () => mockSubscribeOutbox(),
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

function state(name: string): GroupState {
  return {
    group: { id: 'group-1', name, inviteCode: 'RACE01' } as GroupState['group'],
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
});
