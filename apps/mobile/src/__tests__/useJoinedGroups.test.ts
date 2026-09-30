import React from 'react';
const mockLoad = jest.fn();
const mockListeners = new Set<(actor: string, groups: any[]) => void>();
jest.mock('../api/services/GroupService', () => ({
  getMyJoinedGroups: (...args: unknown[]) => mockLoad(...args),
  getCachedMyJoinedGroups: () => null,
  subscribeMyJoinedGroups: (listener: (actor: string, groups: any[]) => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));
import { useJoinedGroups } from '../state/useJoinedGroups';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('account-scoped joined groups recovery', () => {
  beforeEach(() => { mockLoad.mockReset(); });
  it('preserves groups on failure, retries once, and ignores old account responses', async () => {
    const a = [{ group: { id: 'a' } }];
    mockLoad.mockResolvedValueOnce(a);
    let api!: ReturnType<typeof useJoinedGroups>;
    function Harness({ actor }: { actor: string }) { api = useJoinedGroups(actor); return null; }
    let root: any;
    await act(async () => { root = create(React.createElement(Harness, { actor: 'a' })); });
    expect(api.groups).toEqual(a);
    expect(mockLoad).toHaveBeenLastCalledWith({ includeProfiles: true, expectedActorId: 'a' });
    mockLoad.mockRejectedValueOnce(new Error('Network request failed'));
    await act(async () => { api.retry(); api.retry(); });
    expect(mockLoad).toHaveBeenCalledTimes(2);
    expect(api.groups).toEqual(a);
    expect(api.error?.kind).toBe('offline_transport');
    let settle!: (value: unknown) => void;
    mockLoad.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    await act(async () => { api.retry(); });
    expect(api.loading).toBe(true);
    mockLoad.mockResolvedValueOnce([{ group: { id: 'b' } }]);
    await act(async () => { root.update(React.createElement(Harness, { actor: 'b' })); });
    await act(async () => { settle(a); });
    expect(api.groups).toEqual([{ group: { id: 'b' } }]);
    expect(api.error).toBeNull();
    await act(async () => { root.unmount(); });
  });
  it('updates two mounted screens on leave without polling or leaking another account', async () => {
    mockLoad.mockResolvedValue([{ group: { id: 'g' } }]);
    const screens: Record<string, ReturnType<typeof useJoinedGroups>> = {};
    function Harness({ id, actor }: { id: string; actor: string }) {
      screens[id] = useJoinedGroups(actor); return null;
    }
    let root: any;
    await act(async () => { root = create(React.createElement(React.Fragment, null,
      React.createElement(Harness, { id: 'home', actor: 'a' }),
      React.createElement(Harness, { id: 'teams', actor: 'a' }),
      React.createElement(Harness, { id: 'other', actor: 'b' }),
    )); });
    await act(async () => { for (const listener of mockListeners) listener('a', []); });
    expect(screens.home.groups).toEqual([]);
    expect(screens.teams.groups).toEqual([]);
    expect(screens.other.groups).toHaveLength(1);
    expect(mockLoad).toHaveBeenCalledTimes(3);
    await act(async () => { root.unmount(); });
    expect(mockListeners.size).toBe(0);
  });
});
