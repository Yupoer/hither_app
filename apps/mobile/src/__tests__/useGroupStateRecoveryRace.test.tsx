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
});
