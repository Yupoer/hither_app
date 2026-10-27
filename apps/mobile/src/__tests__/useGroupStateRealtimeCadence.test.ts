import React from 'react';
import type { GroupState } from '../types';
import { getVisibleGroupSeed } from '../state/visibleGroupSeed';

const mockRecovery = jest.fn();

type Binding = { filter: Record<string, string>; callback: (payload: unknown) => void };
type FakeChannel = {
  topic: string;
  bindings: Binding[];
  status?: (status: string) => void;
  removed: boolean;
};
const mockChannels: FakeChannel[] = [];

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
    channel: (topic: string) => {
      const record: FakeChannel = { topic, bindings: [], removed: false };
      mockChannels.push(record);
      const api = {
        record,
        on(_type: string, filter: Record<string, string>, callback: (payload: unknown) => void) {
          record.bindings.push({ filter, callback });
          return api;
        },
        subscribe(status?: (status: string) => void) {
          record.status = status;
          return api;
        },
      };
      return api;
    },
    removeChannel: (channel: { record: FakeChannel }) => { channel.record.removed = true; },
  },
}));

jest.mock('../state/coreDataStore', () => ({
  groupStateFromCoreSnapshot: (snapshot: { state?: GroupState }) => snapshot.state,
  readCoreSnapshot: jest.fn(async () => null),
}));

jest.mock('../state/coreDataSync', () => ({
  flushCoreOperationOutbox: jest.fn(async () => undefined),
  hydrateCoreEntityVersions: jest.fn(async () => undefined),
  listOpenCoreOperations: jest.fn(async () => []),
  projectOptimisticGathering: jest.fn(),
  projectPendingDestinations: (state: unknown) => state,
  subscribeCoreOutboxChanges: () => () => undefined,
}));

jest.mock('../state/energyObservability', () => ({
  energyObservability: { increment: jest.fn(), event: jest.fn() },
}));

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => { unmount: () => void; update: (element: React.ReactElement) => void };
};
const {
  useGroupState,
  GROUP_POLL_INTERVAL_MS,
  GROUP_POLL_SUBSCRIBED_INTERVAL_MS,
} = require('../state/useGroupState') as typeof import('../state/useGroupState');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let revisionSeq = 0;
function recovery(memberIds: string[], latitude = 25) {
  revisionSeq += 1;
  const revision = new Date(Date.UTC(2026, 9, 1, 0, 0, revisionSeq)).toISOString();
  return {
    state: {
      group: { id: 'group-1', name: 'Trip', inviteCode: 'TRIP01' },
      members: memberIds.map(userId => ({ userId, coordinates: { latitude, longitude: 121 } })),
      destinations: [],
      subgroups: [],
    } as unknown as GroupState,
    generatedAt: revision,
    revision,
    entityVersions: {},
  };
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await flush();
  });
}

const groupChannel = () => mockChannels.find(c => c.topic.startsWith('group:') && !c.removed)!;
const profileChannels = () => mockChannels.filter(c => c.topic.startsWith('group-profiles:'));
const liveProfileChannel = () => profileChannels().find(c => !c.removed);

async function mount() {
  let api!: ReturnType<typeof useGroupState>;
  function Harness() { api = useGroupState('group-1', { myUserId: 'me' }); return api.lifecycle; }
  let root!: { unmount: () => void };
  await act(async () => {
    root = create(React.createElement(Harness));
    await flush();
  });
  return { root, get api() { return api; } };
}

describe('useGroupState realtime cadence', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockChannels.length = 0;
    mockRecovery.mockReset();
    mockRecovery.mockImplementation(async () => recovery(['me', 'peer-b']));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('subscribes to profile updates only for current co-members and resubscribes when the member set changes', async () => {
    const { root } = await mount();
    expect(groupChannel().bindings.some(b => b.filter.table === 'profiles')).toBe(false);
    expect(liveProfileChannel()?.bindings.map(b => b.filter)).toEqual([
      { event: 'UPDATE', schema: 'public', table: 'public_profiles', filter: 'id=in.(me,peer-b)' },
    ]);

    mockRecovery.mockImplementation(async () => recovery(['me', 'peer-b'], 26));
    await act(async () => {
      groupChannel().bindings.find(b => b.filter.table === 'memberships')!.callback({});
      jest.advanceTimersByTime(300);
      await flush();
    });
    expect(profileChannels()).toHaveLength(1);

    mockRecovery.mockImplementation(async () => recovery(['me', 'peer-b', 'peer-c']));
    await act(async () => {
      groupChannel().bindings.find(b => b.filter.table === 'memberships')!.callback({});
      jest.advanceTimersByTime(300);
      await flush();
    });
    expect(profileChannels()).toHaveLength(2);
    expect(profileChannels()[0].removed).toBe(true);
    expect(liveProfileChannel()?.bindings[0].filter.filter).toBe('id=in.(me,peer-b,peer-c)');

    const before = mockRecovery.mock.calls.length;
    await act(async () => {
      liveProfileChannel()!.bindings[0].callback({});
      jest.advanceTimersByTime(300);
      await flush();
    });
    expect(mockRecovery.mock.calls.length).toBe(before + 1);

    await act(async () => root.unmount());
    expect(liveProfileChannel()).toBeUndefined();
  });

  it('polls every 30 s without realtime, backs off while SUBSCRIBED, and returns to 30 s when the channel drops', async () => {
    const { root } = await mount();
    let calls = mockRecovery.mock.calls.length;

    await advance(GROUP_POLL_INTERVAL_MS);
    expect(mockRecovery.mock.calls.length).toBe(calls + 1);

    await act(async () => { groupChannel().status?.('SUBSCRIBED'); await flush(); });
    calls = mockRecovery.mock.calls.length;
    await advance(GROUP_POLL_INTERVAL_MS);
    expect(mockRecovery.mock.calls.length).toBe(calls);
    await advance(GROUP_POLL_SUBSCRIBED_INTERVAL_MS - GROUP_POLL_INTERVAL_MS);
    expect(mockRecovery.mock.calls.length).toBe(calls + 1);

    await act(async () => { groupChannel().status?.('CHANNEL_ERROR'); await flush(); });
    calls = mockRecovery.mock.calls.length;
    await advance(GROUP_POLL_INTERVAL_MS);
    expect(mockRecovery.mock.calls.length).toBe(calls + 1);

    await act(async () => root.unmount());
    calls = mockRecovery.mock.calls.length;
    await advance(GROUP_POLL_SUBSCRIBED_INTERVAL_MS);
    expect(mockRecovery.mock.calls.length).toBe(calls);
  });

  it('keeps the 30 s fallback poll running while realtime fails to rejoin every 10 s', async () => {
    const { root } = await mount();
    await act(async () => { groupChannel().status?.('SUBSCRIBED'); await flush(); });
    const calls = mockRecovery.mock.calls.length;

    for (let i = 0; i < 60; i += 1) {
      await act(async () => { groupChannel().status?.('CHANNEL_ERROR'); await flush(); });
      await advance(10_000);
    }

    expect(mockRecovery.mock.calls.length - calls).toBe(20);
    await act(async () => root.unmount());
  });

  it('never starts a poll while the previous poll load is still in flight', async () => {
    const { root } = await mount();
    mockRecovery.mockImplementation(() => new Promise(() => undefined));
    const calls = mockRecovery.mock.calls.length;
    await advance(GROUP_POLL_INTERVAL_MS);
    expect(mockRecovery.mock.calls.length).toBe(calls + 1);
    await advance(GROUP_POLL_INTERVAL_MS * 3);
    expect(mockRecovery.mock.calls.length).toBe(calls + 1);
    await act(async () => root.unmount());
  });

  it('keeps two hook instances on distinct channels and releases only its committed seed lease', async () => {
    function Observer() { return useGroupState('group-1', { myUserId: 'me' }).lifecycle; }
    const tree = (first: boolean) => React.createElement(React.Fragment, null,
      first && React.createElement(Observer, { key: 'first' }), React.createElement(Observer, { key: 'second' }));
    let root!: ReturnType<typeof create>;
    await act(async () => { root = create(tree(true)); await flush(); });
    const groups = mockChannels.filter(c => c.topic.startsWith('group:') && !c.removed);
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map(c => c.topic)).size).toBe(2);
    const committed = getVisibleGroupSeed('me', 'group-1');
    expect(committed).not.toBeNull();
    await act(async () => { root.update(tree(false)); await flush(); });
    expect(getVisibleGroupSeed('me', 'group-1')).toBe(committed);
    expect(groups.filter(c => !c.removed)).toHaveLength(1);
    await act(async () => root.unmount());
    expect(getVisibleGroupSeed('me', 'group-1')).toBeNull();
    expect(mockChannels.every(c => c.removed)).toBe(true);
  });

  it('fences retired channel callbacks after a group change and Strict replay keeps one live channel', async () => {
    function Observer({ groupId }: { groupId: string }) { return useGroupState(groupId, { myUserId: 'me' }).lifecycle; }
    let root!: ReturnType<typeof create>;
    await act(async () => { root = create(React.createElement(React.StrictMode, null,
      React.createElement(Observer, { groupId: 'group-1' }))); await flush(); });
    expect(mockChannels.filter(c => c.topic.startsWith('group:') && !c.removed)).toHaveLength(1);
    const retired = groupChannel();
    await act(async () => { root.update(React.createElement(React.StrictMode, null,
      React.createElement(Observer, { groupId: 'group-2' }))); await flush(); });
    expect(retired.removed).toBe(true);
    const calls = mockRecovery.mock.calls.length;
    await act(async () => {
      retired.status?.('SUBSCRIBED');
      retired.bindings.find(b => b.filter.table === 'memberships')!.callback({});
      retired.bindings.find(b => b.filter.table === 'member_locations')!.callback({ new: { user_id: 'peer-b' } });
      jest.advanceTimersByTime(300); await flush();
    });
    expect(mockRecovery.mock.calls.length).toBe(calls);
    await act(async () => root.unmount());
    expect(mockChannels.every(c => c.removed)).toBe(true);
  });

  it('does not publish a new actor seed from a suspended render', async () => {
    const never = new Promise<void>(() => undefined);
    function Observer({ actor, suspend }: { actor: string; suspend: boolean }) {
      const group = useGroupState('group-1', { myUserId: actor });
      if (suspend) throw never;
      return group.lifecycle;
    }
    const tree = (actor: string, suspend: boolean) => React.createElement(React.Suspense, { fallback: null },
      React.createElement(Observer, { actor, suspend }));
    let root!: ReturnType<typeof create>;
    await act(async () => { root = create(tree('me', false)); await flush(); });
    const committed = getVisibleGroupSeed('me', 'group-1');
    expect(committed).not.toBeNull();
    await act(async () => { root.update(tree('uncommitted', true)); await flush(); });
    expect(getVisibleGroupSeed('uncommitted', 'group-1')).toBeNull();
    expect(getVisibleGroupSeed('me', 'group-1')).toBe(committed);
    await act(async () => root.unmount());
    expect(getVisibleGroupSeed('me', 'group-1')).toBeNull();
  });
});
