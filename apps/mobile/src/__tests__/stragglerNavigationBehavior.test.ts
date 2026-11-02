import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useStragglerReporting } from '../screens/MapScreen/hooks/useStragglerReporting';
import { reportStraggler } from '../api/client';
import * as distances from '../utils/straggler';
import type { GroupState } from '../types';

jest.mock('../api/client', () => ({ reportStraggler: jest.fn().mockResolvedValue(undefined) }));

const group = { id: 'group', name: 'Team', inviteCode: 'CODE01', createdBy: 'captain',
  journeyStatus: 'going', stragglerAlerts: true, stragglerThresholdM: 500 } satisfies GroupState['group'];
const state = (latitude: number): GroupState => ({ group, destinations: [], subgroups: [], members: [
  { userId: 'captain', name: 'Captain', role: 'leader', status: 'active', coordinates: { latitude: 25, longitude: 121 } },
  { userId: 'peer', name: 'Peer', role: 'follower', status: 'active', coordinates: { latitude, longitude: 121 } },
] });

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('does no idle distance work, resets hysteresis/report state, and keeps reporting after personal arrival', () => {
  const calculate = jest.spyOn(distances, 'findStragglers');
  let tree: ReactTestRenderer;
  function Host({ active, latitude, arrived = false }: { active: boolean; latitude: number; arrived?: boolean }) {
    const current = state(latitude);
    const result = useStragglerReporting({ fromCoords: { latitude: 25, longitude: 121 }, group,
      groupId: group.id, isLeader: true, navigationActive: active, state: current,
      user: { id: 'captain', name: 'Captain', email: '', }, });
    return React.createElement(React.Fragment, null, result.lifecycle, arrived ? 'Arrived' : 'Navigating');
  }
  act(() => { tree = create(React.createElement(Host, { active: false, latitude: 25.006 })); });
  expect(calculate).not.toHaveBeenCalled();
  expect(reportStraggler).not.toHaveBeenCalled();
  act(() => { tree.update(React.createElement(Host, { active: true, latitude: 25.006, arrived: true })); });
  expect(reportStraggler).toHaveBeenCalledTimes(1);
  expect(reportStraggler).toHaveBeenLastCalledWith('group', 'peer', expect.any(Number));
  act(() => { tree.update(React.createElement(Host, { active: true, latitude: 25.004 })); });
  expect(reportStraggler).toHaveBeenCalledTimes(1);
  calculate.mockClear();
  act(() => { tree.update(React.createElement(Host, { active: false, latitude: 25.004 })); });
  expect(calculate).not.toHaveBeenCalled();
  act(() => { tree.update(React.createElement(Host, { active: true, latitude: 25.004 })); });
  expect(reportStraggler).toHaveBeenCalledTimes(1);
  act(() => { tree.update(React.createElement(Host, { active: true, latitude: 25.006 })); });
  expect(reportStraggler).toHaveBeenCalledTimes(2);
  act(() => { tree.unmount(); });
  calculate.mockRestore();
});
