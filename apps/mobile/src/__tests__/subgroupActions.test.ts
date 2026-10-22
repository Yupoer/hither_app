import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { MemberLocation, Subgroup } from '../types';

const mockStorage = new Map<string, string>();
const mockAlert = jest.fn();
const mockInvites = {
  invites: [{ id: 'inv-1' }],
  accept: jest.fn(async () => undefined),
  decline: jest.fn(async () => undefined),
  refresh: jest.fn(),
};
const mockClient = {
  fetchSentInvites: jest.fn(async () => [{ id: 'sent-1', inviteeName: 'Bo' }]),
  inviteToSubgroup: jest.fn(async () => undefined),
  selfMerge: jest.fn(async () => undefined),
  selfSplit: jest.fn(async () => undefined),
};

jest.mock('react-native', () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockStorage.set(key, value); },
  },
}));
jest.mock('../api/client', () => mockClient);
jest.mock('../api/demo', () => ({ isDemoGroup: (id: string | null) => id === 'demo' }));
jest.mock('../state/useSubgroupInvites', () => ({ useSubgroupInvites: () => mockInvites }));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn(), logError: jest.fn() }));
jest.mock('../utils/haptics', () => ({ mediumTap: jest.fn(), selectionTick: jest.fn() }));

import {
  LEAVE_GROUP_WARN_KEY,
  useSubgroupActions,
  type UseSubgroupActionsInput,
} from '../screens/MapScreen/hooks/useSubgroupActions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const member = (userId: string, subgroupId?: string) => ({ userId, subgroupId }) as MemberLocation;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('useSubgroupActions', () => {
  let actions: ReturnType<typeof useSubgroupActions> | undefined;
  let renderer: ReactTestRenderer | undefined;
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
      actions = useSubgroupActions(props);
      return null;
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
    await act(flush);
    expect(actions?.subgroups.map((subgroup) => subgroup.id)).toEqual(['s1']);
    expect(mockClient.fetchSentInvites).toHaveBeenCalledWith('s1');
    expect(actions?.sentInvites).toEqual([{ id: 'sent-1', inviteeName: 'Bo' }]);
  });

  it('asks before leaving the main team, remembers "don\'t show again", then accepts and reloads membership', async () => {
    render();
    let accepted: Promise<void> | undefined;
    act(() => { accepted = actions?.handleAcceptInvite('inv-1'); });
    await act(flush);
    expect(mockInvites.accept).not.toHaveBeenCalled();
    const buttons = mockAlert.mock.calls[0][2] as { onPress: () => void }[];
    await act(async () => { buttons[0].onPress(); await accepted; });
    expect(mockInvites.accept).toHaveBeenCalledWith('inv-1');
    expect(refresh).toHaveBeenCalledWith('membership_change');
    expect(mockStorage.get(LEAVE_GROUP_WARN_KEY)).toBe('1');

    mockAlert.mockClear();
    await act(async () => { await actions?.handleAcceptInvite('inv-2'); });
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockInvites.accept).toHaveBeenLastCalledWith('inv-2');
  });

  it('splits me into a team named after me once the warning is dismissed', async () => {
    mockStorage.set(LEAVE_GROUP_WARN_KEY, '1');
    render();
    let ok: boolean | undefined;
    await act(async () => { ok = await actions?.doSelfSplit(); });
    expect(ok).toBe(true);
    expect(mockClient.selfSplit).toHaveBeenCalledWith('g1', 'subgroup.selfSplitName:{"name":"Ada"}');
  });

  it('wipes subgroup-scoped UI when I merge back, and reports failure without wiping', async () => {
    render();
    await act(async () => { await actions?.doSelfMerge(); });
    expect(onMergedBack).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();

    mockClient.selfMerge.mockRejectedValueOnce(new Error('nope'));
    let ok: boolean | undefined;
    await act(async () => { ok = await actions?.doSelfMerge(); });
    expect(ok).toBe(false);
    expect(onMergedBack).toHaveBeenCalledTimes(1);
    expect(mockAlert).toHaveBeenCalledWith('subgroup.failed', 'nope');
  });

  it('refreshes the invite list right away only for the demo flock after sending', async () => {
    render({ groupId: 'demo' });
    await act(async () => { await actions?.handleInvite('s1', 'u2'); });
    expect(mockClient.inviteToSubgroup).toHaveBeenCalledWith('s1', 'u2');
    expect(mockInvites.refresh).toHaveBeenCalledTimes(1);
    act(() => renderer?.unmount());
    renderer = undefined;
    render({ groupId: 'g1' });
    await act(async () => { await actions?.handleInvite('s1', 'u2'); });
    expect(mockInvites.refresh).toHaveBeenCalledTimes(1);
  });
});
