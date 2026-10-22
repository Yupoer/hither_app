import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { deriveGroupRole, useGroupRole, type UseGroupRoleInput } from '../screens/MapScreen/hooks/useGroupRole';
import type { Membership } from '../state/SessionContext';
import type { Group } from '../types';
import type { CoreOperation } from '../types/coreData';

jest.mock('../api/demo', () => ({ isDemoGroup: (id: string | null) => id === 'demo' }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const group = { id: 'g1', name: 'Trip', inviteCode: 'ABC' } as Group;
const leaderMembership: Membership = { group, role: 'leader' };
const followerMembership: Membership = { group, role: 'follower' };
const base = {
  groupId: 'g1',
  userId: 'u1',
  me: undefined,
  membership: null,
  subgroups: [],
  leaderRevoked: false,
};

function rejection(id: string, operationType = 'reorder_destinations', actorId = 'u1'): CoreOperation {
  return {
    id,
    groupId: 'g1',
    entityType: 'itinerary',
    entityId: 'g1',
    entityVersion: 0,
    operationType,
    actorId,
    payload: { actorId },
    status: 'conflict',
    conflictResult: { code: '42501', message: 'leader membership required' },
    attempts: 1,
    createdAt: 1,
    updatedAt: 1,
  } as unknown as CoreOperation;
}

describe('deriveGroupRole', () => {
  it('prefers the group-state membership row over the persisted session role', () => {
    expect(deriveGroupRole({ ...base, me: { role: 'follower' }, membership: leaderMembership }))
      .toMatchObject({ role: 'follower', isLeader: false, canEditItinerary: false });
    expect(deriveGroupRole({ ...base, me: { role: 'leader' }, membership: followerMembership }))
      .toMatchObject({ role: 'leader', isLeader: true, canEditItinerary: true });
  });

  it('uses the session role only for the same group before group state loads', () => {
    expect(deriveGroupRole({ ...base, membership: leaderMembership }))
      .toMatchObject({ role: 'leader', isLeader: true });
    expect(deriveGroupRole({ ...base, groupId: 'other', membership: leaderMembership }))
      .toMatchObject({ role: null, isLeader: false, canEditItinerary: false });
  });

  it('lets a subgroup leader edit its itinerary without main-leader rights', () => {
    const subgroups = [{ id: 's1', leaderId: 'u1' }, { id: 's2', leaderId: 'u2' }];
    expect(deriveGroupRole({ ...base, me: { role: 'follower', subgroupId: 's1' }, subgroups }))
      .toEqual({ role: 'follower', isLeader: false, isMySubgroupLeader: true, canEditItinerary: true });
    expect(deriveGroupRole({ ...base, me: { role: 'follower', subgroupId: 's2' }, subgroups }))
      .toMatchObject({ isMySubgroupLeader: false, canEditItinerary: false });
  });

  it('blocks every edit right after the server revokes the leader role', () => {
    const subgroups = [{ id: 's1', leaderId: 'u1' }];
    expect(deriveGroupRole({ ...base, me: { role: 'leader', subgroupId: 's1' }, subgroups, leaderRevoked: true }))
      .toEqual({ role: 'leader', isLeader: false, isMySubgroupLeader: true, canEditItinerary: false });
  });

  it('treats the demo flock as led by the tester, but still honors a revocation for edits', () => {
    expect(deriveGroupRole({ ...base, groupId: 'demo' }))
      .toMatchObject({ isLeader: true, canEditItinerary: true });
    expect(deriveGroupRole({ ...base, groupId: 'demo', leaderRevoked: true }))
      .toMatchObject({ isLeader: true, canEditItinerary: false });
  });
});

describe('useGroupRole', () => {
  let current: ReturnType<typeof useGroupRole> | undefined;
  let renderer: ReactTestRenderer | undefined;

  function input(overrides: Partial<UseGroupRoleInput> = {}): UseGroupRoleInput {
    return {
      groupId: 'g1',
      userId: 'u1',
      me: { role: 'leader' },
      membership: leaderMembership,
      setMembership: jest.fn(),
      group,
      subgroups: [],
      dataSource: 'local_cache',
      openOperations: [],
      arrivalOperations: [],
      refresh: jest.fn(async () => true),
      ...overrides,
    };
  }

  function Harness({ props }: { props: UseGroupRoleInput }) {
    current = useGroupRole(props);
    return current.lifecycle;
  }

  function render(props: UseGroupRoleInput) {
    act(() => {
      if (renderer) renderer.update(React.createElement(Harness, { props }));
      else renderer = create(React.createElement(Harness, { props }));
    });
  }

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    current = undefined;
  });

  it('writes a server-confirmed role change back to the session', () => {
    const setMembership = jest.fn();
    render(input({ me: { role: 'follower' }, setMembership, dataSource: 'remote' }));
    expect(setMembership).toHaveBeenCalledWith({ group, role: 'follower' });
  });

  it('does not write back from a local snapshot or for another group', () => {
    const setMembership = jest.fn();
    render(input({ me: { role: 'follower' }, setMembership, dataSource: 'local_cache' }));
    render(input({ me: { role: 'follower' }, setMembership, dataSource: 'remote', groupId: 'g2' }));
    expect(setMembership).not.toHaveBeenCalled();
  });

  it('revokes editing on a leader-role rejection and refreshes once per rejected operation', () => {
    const refresh = jest.fn(async () => true);
    const props = input({ refresh });
    render(props);
    expect(current?.canEditItinerary).toBe(true);
    const openOperations = [rejection('op-1')];
    render({ ...props, openOperations });
    expect(current).toMatchObject({ isLeader: false, canEditItinerary: false });
    expect(refresh).toHaveBeenCalledTimes(1);
    render({ ...props, openOperations: [...openOperations] });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores arrival conflicts in the itinerary queue but revokes on own arrival-queue rejections', () => {
    const props = input();
    render({ ...props, openOperations: [rejection('arr-1', 'record_arrival')] });
    expect(current?.canEditItinerary).toBe(true);
    render({ ...props, arrivalOperations: [rejection('arr-2', 'leader_correct_arrival', 'someone-else')] });
    expect(current?.canEditItinerary).toBe(true);
    render({ ...props, arrivalOperations: [rejection('arr-3', 'leader_correct_arrival')] });
    expect(current?.canEditItinerary).toBe(false);
  });

  it('restores the role after a remote load confirms membership', () => {
    const props = input();
    render(props);
    act(() => current?.markLeaderRevoked());
    expect(current?.isLeader).toBe(false);
    render({ ...props, dataSource: 'remote' });
    expect(current?.isLeader).toBe(true);
  });

  it('scopes a revocation to the user and group it happened in', () => {
    const props = input();
    render(props);
    act(() => current?.markLeaderRevoked());
    expect(current?.canEditItinerary).toBe(false);
    render({ ...props, groupId: 'g2', membership: { group: { ...group, id: 'g2' }, role: 'leader' } });
    expect(current?.canEditItinerary).toBe(true);
  });
  it('publishes committed membership for reference and callback changes without restarting on same inputs', () => {
    const setMembership = jest.fn();
    const props = input({ me: { role: 'follower' }, setMembership, dataSource: 'remote' });
    render(props);
    expect(setMembership).toHaveBeenCalledTimes(1);
    render(props);
    expect(setMembership).toHaveBeenCalledTimes(1);
    render({ ...props, me: { role: 'follower' } });
    expect(setMembership).toHaveBeenCalledTimes(2);
    const replacement = jest.fn();
    render({ ...props, setMembership: replacement });
    expect(replacement).toHaveBeenCalledTimes(1);
    render(props);
    expect(setMembership).toHaveBeenCalledTimes(3);
  });

  it('applies a same-commit rejection after remote membership confirmation', () => {
    const refresh = jest.fn(async () => true);
    const props = input({ dataSource: 'remote', refresh, openOperations: [rejection('same-commit')] });
    render(props);
    expect(current?.canEditItinerary).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    render({ ...props, me: { role: 'leader' } });
    expect(current?.canEditItinerary).toBe(true);
  });

  it('does not publish membership from an abandoned suspended render', () => {
    const setMembership = jest.fn();
    const pending = new Promise<void>(() => {});
    const props = input({ dataSource: 'remote', me: { role: 'follower' }, setMembership });
    function Suspended(): React.ReactElement {
      useGroupRole(props);
      throw pending;
    }
    act(() => { renderer = create(React.createElement(React.Suspense, { fallback: null }, React.createElement(Suspended))); });
    expect(setMembership).not.toHaveBeenCalled();
  });

});
