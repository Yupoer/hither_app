import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { MemberLocation, Subgroup } from '../types';
import { useMountEffect } from '../hooks/useMountEffect';
import {
  LEAVE_GROUP_WARN_KEY,
  useSubgroupActions,
  type UseSubgroupActionsInput,
} from '../screens/MapScreen/hooks/useSubgroupActions';

const mockInviteMount = jest.fn();
const mockInviteCleanup = jest.fn();
function InviteLifecycleProbe() { useMountEffect(() => { mockInviteMount(); return mockInviteCleanup; }); return null; }

const mockStorage = new Map<string, string>();
const mockAlert = jest.fn();
const mockInvites = {
  lifecycle: React.createElement(InviteLifecycleProbe),
  invites: [{ id: 'inv-1' }],
  accept: jest.fn(async () => undefined),
  decline: jest.fn(async () => undefined),
  refresh: jest.fn(),
};
const mockClient = {
  fetchSentInvites: jest.fn(async (_subgroupId: string) => [{ id: 'sent-1', inviteeName: 'Bo' }]),
  inviteToSubgroup: jest.fn(async (_subgroupId: string, _inviteeId: string) => undefined),
  selfMerge: jest.fn(async (_groupId: string) => undefined),
  selfSplit: jest.fn(async (_groupId: string, _name: string): Promise<Subgroup> => ({ id: 'new-subgroup', name: 'Your subgroup', mode: 'led' })),
};

jest.mock('react-native', () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockStorage.set(key, value); },
  },
}));
jest.mock('../api/client', () => ({
  fetchSentInvites: (subgroupId: string) => mockClient.fetchSentInvites(subgroupId),
  inviteToSubgroup: (subgroupId: string, inviteeId: string) => mockClient.inviteToSubgroup(subgroupId, inviteeId),
  selfMerge: (groupId: string) => mockClient.selfMerge(groupId),
  selfSplit: (groupId: string, name: string) => mockClient.selfSplit(groupId, name),
}));
jest.mock('../api/demo', () => ({ isDemoGroup: (id: string | null) => id === 'demo' }));
jest.mock('../state/useSubgroupInvites', () => ({ useSubgroupInvites: () => mockInvites }));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn(), logError: jest.fn() }));
jest.mock('../utils/haptics', () => ({ mediumTap: jest.fn(), selectionTick: jest.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const member = (userId: string, subgroupId?: string) => ({ userId, subgroupId }) as MemberLocation;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function ActionsSnapshot(_props: { actions: ReturnType<typeof useSubgroupActions> }) { return null; }

describe('useSubgroupActions', () => {
  let renderer: ReactTestRenderer | undefined;
  function readActions(): ReturnType<typeof useSubgroupActions> {
    return renderer!.root.findByType(ActionsSnapshot).props.actions;
  }
  const refresh = jest.fn(async () => true);
  const onMergedBack = jest.fn();

  function render(overrides: Partial<UseSubgroupActionsInput> = {}) {
    const props: UseSubgroupActionsInput = {
      groupId: 'g1',
      userName: 'Ada',
      members: [member('u1', 's1'), member('u2')],
      allSubgroups: [{ id: 's1', name: 'A' }, { id: 'empty', name: 'B' }] as Subgroup[],
      mySubgroupId: 's1',
      refresh,
      t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
      onMergedBack,
      ...overrides,
    };
    function Harness() {
      const actions = useSubgroupActions(props);
      return React.createElement(React.Fragment, null, actions.lifecycle, React.createElement(ActionsSnapshot, { actions }));
    }
    act(() => { renderer = create(React.createElement(Harness)); });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('hides subgroups that no member is in and loads my pending sent invites', async () => {
    render();
    expect(mockInviteMount).toHaveBeenCalledTimes(1);
    await act(flush);
    expect(readActions().subgroups.map((subgroup) => subgroup.id)).toEqual(['s1']);
    expect(mockClient.fetchSentInvites).toHaveBeenCalledWith('s1');
    expect(readActions().sentInvites).toEqual([{ id: 'sent-1', inviteeName: 'Bo' }]);
  });

  it('asks before leaving the main team, remembers "don\'t show again", then accepts and reloads membership', async () => {
    render();
    let accepted: Promise<void> | undefined;
    act(() => { accepted = readActions().handleAcceptInvite('inv-1'); });
    await act(flush);
    expect(mockInvites.accept).not.toHaveBeenCalled();
    const buttons = mockAlert.mock.calls[0][2] as { onPress: () => void }[];
    await act(async () => { buttons[0].onPress(); await accepted; });
    expect(mockInvites.accept).toHaveBeenCalledWith('inv-1');
    expect(refresh).toHaveBeenCalledWith('membership_change');
    expect(mockStorage.get(LEAVE_GROUP_WARN_KEY)).toBe('1');

    mockAlert.mockClear();
    await act(async () => { await readActions().handleAcceptInvite('inv-2'); });
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockInvites.accept).toHaveBeenLastCalledWith('inv-2');
  });

  it('splits me into a team named after me once the warning is dismissed', async () => {
    mockStorage.set(LEAVE_GROUP_WARN_KEY, '1');
    render();
    let ok: boolean | undefined;
    await act(async () => { ok = await readActions().doSelfSplit(); });
    expect(ok).toBe(true);
    expect(mockClient.selfSplit).toHaveBeenCalledWith('g1', 'subgroup.selfSplitName:{"name":"Ada"}');
  });

  it('creates once for the selected self and invites teammates without silently moving them', async () => {
    mockStorage.set(LEAVE_GROUP_WARN_KEY, '1');
    render({ mySubgroupId: undefined, members: [member('u1'), member('u2'), member('u3')] });

    await act(async () => {
      expect(await readActions().createSubgroup(['u2'], 'u1')).toBe(false);
      const selection = ['u1', 'u2', 'u2', 'missing'];
      const creation = readActions().createSubgroup(selection, 'u1');
      expect(await readActions().createSubgroup(selection, 'u1')).toBe(false);
      expect(await creation).toBe(true);
    });
    expect(mockClient.selfSplit).toHaveBeenCalledTimes(1);
    expect(mockClient.selfSplit).toHaveBeenCalledWith('g1', 'd6.team.yourSubgroup');
    expect(mockClient.inviteToSubgroup.mock.calls).toEqual([['new-subgroup', 'u2']]);
    expect(refresh).toHaveBeenCalledWith('membership_change');
  });

  it('keeps the created subgroup when an invitation fails and reports the missed teammate', async () => {
    mockStorage.set(LEAVE_GROUP_WARN_KEY, '1');
    mockClient.inviteToSubgroup.mockRejectedValueOnce(new Error('network unavailable'));
    render({ mySubgroupId: undefined, members: [member('u1'), { ...member('u2'), name: 'Ming' }] });

    await act(async () => {
      expect(await readActions().createSubgroup(['u1', 'u2'], 'u1')).toBe(true);
    });
    expect(mockAlert).toHaveBeenCalledWith('subgroup.failed', 'd6.team.inviteFailed:{"names":"Ming"}');
    expect(refresh).toHaveBeenCalledWith('membership_change');
  });

  it('wipes subgroup-scoped UI when I merge back, and reports failure without wiping', async () => {
    render();
    await act(async () => { await readActions().doSelfMerge(); });
    expect(onMergedBack).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();

    mockClient.selfMerge.mockRejectedValueOnce(new Error('nope'));
    let ok: boolean | undefined;
    await act(async () => { ok = await readActions().doSelfMerge(); });
    expect(ok).toBe(false);
    expect(onMergedBack).toHaveBeenCalledTimes(1);
    expect(mockAlert).toHaveBeenCalledWith('subgroup.failed', 'nope');
  });

  it('refreshes the invite list right away only for the demo flock after sending', async () => {
    render({ groupId: 'demo' });
    await act(async () => { await readActions().handleInvite('s1', 'u2'); });
    expect(mockClient.inviteToSubgroup).toHaveBeenCalledWith('s1', 'u2');
    expect(mockInvites.refresh).toHaveBeenCalledTimes(1);
    act(() => renderer?.unmount());
    renderer = undefined;
    render({ groupId: 'g1' });
    await act(async () => { await readActions().handleInvite('s1', 'u2'); });
    expect(mockInvites.refresh).toHaveBeenCalledTimes(1);
  });
});
