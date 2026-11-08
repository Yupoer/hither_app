import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MapAccessLossResource, MapRouteOpenResource } from '../screens/MapScreen/MapScreenChromeResources';

const mockAlert = jest.fn();
jest.mock('react-native', () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));
jest.mock('../api/demo', () => ({ isDemoGroup: () => false }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MapScreen chrome resource ownership', () => {
  let tree: ReactTestRenderer | undefined;
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.clearAllMocks(); });

  it('keeps Map on temporary recovery failure and exits only on confirmed access loss', () => {
    const leaveGroup = jest.fn();
    const reset = jest.fn();
    const props = {
      user: { id: 'me' }, groupId: 'group', membership: { group: { id: 'group' } },
      groupStateError: 'not_member', kickedHandledRef: { current: false }, leaveGroup,
      voluntaryLeaveRef: { current: false }, t: (key: string) => key, navigation: { reset },
    };
    act(() => { tree = create(React.createElement(MapAccessLossResource, { ...props, groupStateError: 'Network request failed' })); });
    expect(leaveGroup).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
    act(() => tree?.update(React.createElement(MapAccessLossResource, props)));
    expect(leaveGroup).toHaveBeenCalledTimes(1);
    act(() => tree?.update(React.createElement(MapAccessLossResource, { ...props, user: { id: 'me' } })));
    expect(leaveGroup).toHaveBeenCalledTimes(1);
    act(() => tree?.update(React.createElement(MapAccessLossResource, { ...props, groupStateError: null })));
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
});
