import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MapAccessLossResource, MapGatherRequestPagerResource, MapRouteOpenResource } from '../screens/MapScreen/MapScreenChromeResources';

const mockAlert = jest.fn();
jest.mock('react-native', () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));
jest.mock('../api/demo', () => ({ isDemoGroup: () => false }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MapScreen chrome resource ownership', () => {
  let tree: ReactTestRenderer | undefined;
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.clearAllMocks(); });

  it('deduplicates access-loss handling across new state objects and rearms only after membership returns', () => {
    const leaveGroup = jest.fn();
    const reset = jest.fn();
    const props = {
      user: { id: 'me' }, groupId: 'group', membership: { group: { id: 'group' } }, isLeader: false,
      members: [{ userId: 'peer' }], groupStateError: 'not_member', loading: false,
      state: { group: { id: 'group' } }, kickedHandledRef: { current: false }, leaveGroup,
      voluntaryLeaveRef: { current: false }, t: (key: string) => key, navigation: { reset },
    };
    act(() => { tree = create(React.createElement(MapAccessLossResource, props)); });
    expect(leaveGroup).toHaveBeenCalledTimes(1);
    act(() => tree?.update(React.createElement(MapAccessLossResource, { ...props, state: { group: { id: 'group' } } })));
    expect(leaveGroup).toHaveBeenCalledTimes(1);
    act(() => tree?.update(React.createElement(MapAccessLossResource, { ...props, members: [{ userId: 'me' }], groupStateError: null })));
    expect(props.kickedHandledRef.current).toBe(false);
    act(() => tree?.update(React.createElement(MapAccessLossResource, props)));
    expect(leaveGroup).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenLastCalledWith({ index: 0, routes: [{ name: 'RoleSelect' }] });
    expect(mockAlert).toHaveBeenCalledTimes(2);
  });

  it('syncs each open once and ignores old close/reopen completions without resetting drafts', async () => {
    const finishes: (() => void)[] = [];
    const sync = jest.fn(() => new Promise<void>(resolve => finishes.push(resolve)));
    const changedSync = jest.fn(() => new Promise<void>(resolve => finishes.push(resolve)));
    const session = { current: 'idle' as 'idle' | 'started' | 'done' };
    const generation = { current: 0 };
    const setMode = jest.fn();
    const setIds = jest.fn();
    const props = { overlay: 'route', syncFromDatabase: sync, routeOpenSyncSessionRef: session,
      routeOpenSyncGenerationRef: generation, setRouteInteractionMode: setMode, setRouteSelectedIds: setIds };
    act(() => { tree = create(React.createElement(React.StrictMode, null, React.createElement(MapRouteOpenResource, props))); });
    expect(sync).toHaveBeenCalledTimes(1);
    act(() => tree?.update(React.createElement(React.StrictMode, null, React.createElement(MapRouteOpenResource, { ...props, syncFromDatabase: changedSync }))));
    expect(changedSync).not.toHaveBeenCalled();
    act(() => tree?.update(React.createElement(React.StrictMode, null, React.createElement(MapRouteOpenResource, { ...props, overlay: null }))));
    expect(setMode).toHaveBeenCalledWith('drag');
    expect(setIds).toHaveBeenCalledWith([]);
    act(() => tree?.update(React.createElement(React.StrictMode, null, React.createElement(MapRouteOpenResource, { ...props, syncFromDatabase: changedSync }))));
    expect(changedSync).toHaveBeenCalledTimes(1);
    await act(async () => { finishes[0](); });
    expect(session.current).toBe('started');
    await act(async () => { finishes[1](); });
    expect(session.current).toBe('done');
  });

  it('keeps FIFO removal selection and native pager ownership across equal-value new id arrays', () => {
    const scrollTo = jest.fn();
    const lastIds = { current: ['a', 'b', 'c'] };
    const removed = { current: null as string | null };
    const pager = { current: { scrollTo } };
    let selected = '';
    function Owner({ ids }: { ids: string[] }) {
      const [id, setId] = useState<string | null>('b');
      selected = id ?? '';
      return React.createElement(MapGatherRequestPagerResource, {
        sortedGatherRequestIds: ids, selectedGatherRequestId: id, setSelectedGatherRequestId: setId,
        lastGatherRequestIdsRef: lastIds, pendingRemovedGatherRequestIdRef: removed,
        gatherRequestPageW: 300, gatherRequestPagerRef: pager,
      });
    }
    act(() => { tree = create(React.createElement(Owner, { ids: lastIds.current })); });
    expect(selected).toBe('b');
    removed.current = 'b';
    const nextIds = ['a', 'c'];
    act(() => tree?.update(React.createElement(Owner, { ids: nextIds })));
    expect(selected).toBe('c');
    expect(lastIds.current).toBe(nextIds);
    expect(removed.current).toBeNull();
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 300, animated: true });
    const before = scrollTo.mock.calls.length;
    act(() => tree?.update(React.createElement(Owner, { ids: ['a', 'c'] })));
    expect(scrollTo).toHaveBeenCalledTimes(before + 1);
    expect(pager.current.scrollTo).toBe(scrollTo);
    expect(selected).toBe('c');
  });
});
