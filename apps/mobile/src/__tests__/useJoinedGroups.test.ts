import React from 'react';
const mockLoad = jest.fn();
jest.mock('../api/services/GroupService', () => ({
  getMyJoinedGroups: (...args: unknown[]) => mockLoad(...args),
  getCachedMyJoinedGroups: () => null,
}));
import { useJoinedGroups } from '../state/useJoinedGroups';
const { act, create } = require('react-test-renderer');

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
});
