jest.mock('../state/appNotice', () => ({ showOperationFailure: jest.fn(), showAppNotice: jest.fn() }));
import { showOperationFailure, showAppNotice } from '../state/appNotice';
jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'operation-id') }));
jest.mock('../utils/operationError', () => ({ getOperationErrorMessage: () => 'local storage failed' }));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn() }));
jest.mock('../native/externalNavigation', () => ({ presentExternalMapsChooser: jest.fn() }));
jest.mock('../state/coreDataSync', () => ({
  enqueueLeaderGatheringStart: jest.fn(), enqueueLeaderGatheringSwitch: jest.fn(),
  enqueueLeaderGatheringEnd: jest.fn(), flushCoreOperationOutbox: jest.fn(async () => undefined),
  getCoreOperationOutbox: () => ({ getOperation: mockGetOperation }),
}));
const mockGetOperation = jest.fn(async (): Promise<unknown> => ({ status: 'pending' }));
import React from 'react';
import { Alert } from 'react-native';
import { useJourneyNavigation } from '../screens/MapScreen/hooks/useJourneyNavigation';
import * as sync from '../state/coreDataSync';
import type { Destination, GroupState } from '../types';
import type { NavigationSession } from '../types/navigation';
// This harness has no native views and belongs in the node test runner.
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const first: Destination = { id: 'a', title: 'A', coordinates: { latitude: 25, longitude: 121 }, day: 1, order: 0 };
const second: Destination = { ...first, id: 'b', title: 'B', order: 1 };
const base = { groupId: 'g', journeyPhase: 'staying', activeDestinationId: null,
  pointStatuses: {}, phaseChangedAt: 0, entityVersion: 0 };
const state = { group: { id: 'g', journeyStatus: 'paused' }, destinations: [first, second], members: [], subgroups: [] } as unknown as GroupState;
const saved = (target: string | null, version: number) => ({ local: { ...base,
  journeyPhase: target ? 'en_route' : 'staying', activeDestinationId: target, entityVersion: version },
  base, operationId: `op-${version}` });
let api: ReturnType<typeof useJourneyNavigation>;
let root: { unmount: () => void; update: (element: React.ReactElement) => void };
const startSession = jest.fn();
const cancelSession = jest.fn();
const projection = jest.fn();
const pauseConfirm = jest.fn();
const localSessionChanges: Array<string | null> = [];
const onLocalSessionIdChange = (sessionId: string | null) => localSessionChanges.push(sessionId);
function Harness({ groupId = 'g', navigationSession = null, groupState, hasPendingTeamOperation = true }: {
  groupId?: string;
  navigationSession?: NavigationSession | null;
  groupState?: GroupState;
  hasPendingTeamOperation?: boolean;
}) {
  const currentState = groupState ?? (groupId === 'g' ? state : { ...state, group: { ...state.group, id: groupId } });
  const currentApi = useJourneyNavigation({ state: currentState, groupId, isLeader: true, destinations: [first, second],
    selectedDestination: first, fromCoords: undefined, refresh: jest.fn(), t: key => key,
    mapRef: { current: null }, carouselRef: { current: null }, setSelectedIndex: jest.fn(),
    navigationSession, startSession, cancelSession, hasPendingTeamOperation,
    onOptimisticGathering: projection, onOperatorPauseConfirm: pauseConfirm,
    onLocalSessionIdChange });
  React.useLayoutEffect(() => { api = currentApi; });
  return null;
}
beforeEach(async () => {
  jest.clearAllMocks();
  localSessionChanges.length = 0;
  mockGetOperation.mockResolvedValue({ status: 'pending' });
  await act(async () => { root = create(React.createElement(Harness)); });
});
afterEach(async () => { await act(async () => root.unmount()); });

it('persists every Start End Start in tap order before projection without legacy online mutations', async () => {
  const calls: string[] = [];
  let release!: (value: any) => void;
  jest.mocked(sync.enqueueLeaderGatheringStart).mockImplementationOnce(() => {
    calls.push('start:a'); return new Promise(resolve => { release = resolve; });
  }).mockImplementationOnce(async () => { calls.push('start:b'); return saved('b', 3) as any; });
  jest.mocked(sync.enqueueLeaderGatheringEnd).mockImplementationOnce(async () => {
    calls.push('end'); return saved(null, 2) as any;
  });
  await act(async () => {
    await api.startNavigation(first, 0);
    await api.requestTeamEnd(first, 0);
    await api.startNavigation(second, 1);
  });
  expect(calls).toEqual(['start:a']);
  expect(projection).not.toHaveBeenCalled();
  expect(api.navTargetId).toBe('b');
  await act(async () => { release(saved('a', 1)); });
  expect(calls).toEqual(['start:a', 'end', 'start:b']);
  expect(projection.mock.calls.map(([value]) => value.activeDestinationId)).toEqual(['b']);
  expect(api.navTargetId).toBe('b');
  expect(startSession).not.toHaveBeenCalled();
  expect(cancelSession).not.toHaveBeenCalled();
  expect(pauseConfirm).not.toHaveBeenCalled();
});

it('shows Start immediately and coalesces repeated taps while its local write is pending', async () => {
  let release!: (value: any) => void;
  jest.mocked(sync.enqueueLeaderGatheringStart).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { await api.startNavigation(first, 0); });
  expect(api.navTargetId).toBe('a');
  expect(api.journeyGoing).toBe(true);
  expect(projection).not.toHaveBeenCalled();
  await act(async () => { await api.startNavigation(first, 0); });
  expect(sync.enqueueLeaderGatheringStart).toHaveBeenCalledTimes(1);
  await act(async () => { release(saved('a', 1)); });
  await act(async () => { await api.startNavigation(first, 0); });
  expect(sync.enqueueLeaderGatheringStart).toHaveBeenCalledTimes(1);
});

it('keeps same-destination End then Start in the same render as distinct ordered commands', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValueOnce(saved('a', 1) as any)
    .mockResolvedValueOnce(saved('a', 3) as any);
  jest.mocked(sync.enqueueLeaderGatheringEnd).mockResolvedValue(saved(null, 2) as any);
  await act(async () => { await api.startNavigation(first, 0); });
  await act(async () => {
    void api.requestTeamEnd(first, 0);
    await api.startNavigation(first, 0);
  });
  expect(sync.enqueueLeaderGatheringStart).toHaveBeenCalledTimes(2);
  expect(sync.enqueueLeaderGatheringEnd).toHaveBeenCalledTimes(1);
  expect(api.navTargetId).toBe('a');
});

it('does not expose an older queued Start alias for the newest visible target', async () => {
  let releaseA!: (value: any) => void;
  let releaseB!: (value: any) => void;
  jest.mocked(sync.enqueueLeaderGatheringStart).mockImplementationOnce(() => new Promise(resolve => { releaseA = resolve; }));
  jest.mocked(sync.enqueueLeaderGatheringSwitch).mockImplementationOnce(() => new Promise(resolve => { releaseB = resolve; }));
  await act(async () => { await api.startNavigation(first, 0); await api.startNavigation(second, 1); });
  expect(api.navTargetId).toBe('b');
  expect(api.localSessionId).toBeNull();
  await act(async () => { releaseA(saved('a', 1)); });
  expect(api.navTargetId).toBe('b');
  expect(api.localSessionId).toBeNull();
  expect(localSessionChanges).not.toContain('op-1');
  await act(async () => { releaseB(saved('b', 2)); });
  expect(api.localSessionId).toBe('op-2');
  expect(localSessionChanges.at(-1)).toBe('op-2');
});

it('does not resume a paused soft cursor when a later Start fails to save', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValueOnce(saved('a', 1) as any)
    .mockRejectedValueOnce(new Error('storage unavailable'));
  const paused = saved(null, 2);
  jest.mocked(sync.enqueueLeaderGatheringEnd).mockResolvedValue({ ...paused,
    local: { ...paused.local, activeDestinationId: 'a' } } as any);
  await act(async () => { await api.startNavigation(first, 0); });
  await act(async () => { await api.requestTeamEnd(first, 0); });
  await act(async () => { await api.startNavigation(first, 0); });
  expect(api.navTargetId).toBeNull();
  expect(api.journeyGoing).toBe(false);
});

it('confirms Pause only after the current durable command is acknowledged', async () => {
  jest.mocked(sync.enqueueLeaderGatheringEnd).mockResolvedValue(saved(null, 2) as any);
  mockGetOperation.mockResolvedValue(null);
  await act(async () => { await api.requestTeamEnd(first, 0); });
  expect(pauseConfirm).toHaveBeenCalledWith(first, 'pause:g:operation-id');
});

it('ends the offline Start session instead of an older server session', async () => {
  const serverSession: NavigationSession = {
    id: 'server-session-s', groupId: 'g', destinationId: first.id,
    scopeSubgroupId: null,
    destination: { name: first.title, coordinates: first.coordinates, arrivalRadiusMeters: 50 },
    startedBy: 'leader', requestId: 'request-s', startedAt: '2026-09-19T00:00:00Z',
    expiresAt: '2026-09-19T08:00:00Z', status: 'active', version: 1,
  };
  await act(async () => {
    root.update(React.createElement(Harness, { navigationSession: serverSession }));
  });
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('b', 1) as any);
  jest.mocked(sync.enqueueLeaderGatheringEnd).mockResolvedValue(saved(null, 2) as any);
  await act(async () => {
    await api.startNavigation(second, 1);
    await api.stopNavigation();
  });
  expect(jest.mocked(sync.enqueueLeaderGatheringEnd).mock.calls[0][1]?.navigationSessionId)
    .toBe('op-1');
});

it('releases an acknowledged local alias before a later same-destination session takes over', async () => {
  const serverT: NavigationSession = {
    id: 'server-session-t', groupId: 'g', destinationId: second.id,
    scopeSubgroupId: null,
    destination: { name: second.title, coordinates: second.coordinates, arrivalRadiusMeters: 50 },
    startedBy: 'leader', requestId: 'op-1', startedAt: '2026-09-19T01:00:00Z',
    expiresAt: '2026-09-19T08:00:00Z', status: 'active', version: 2,
  };
  const serverU: NavigationSession = {
    ...serverT,
    id: 'server-session-u',
    requestId: 'remote-u',
    startedAt: '2026-09-19T02:00:00Z',
    version: 3,
  };
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('b', 1) as any);
  jest.mocked(sync.enqueueLeaderGatheringEnd).mockResolvedValue(saved(null, 2) as any);

  await act(async () => { await api.startNavigation(second, 1); });
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: serverT })); });
  expect(localSessionChanges).toContain('op-1');
  expect(localSessionChanges).toContain(null);

  await act(async () => { root.update(React.createElement(Harness, { navigationSession: serverU })); });
  await act(async () => { await api.stopNavigation(); });
  expect(jest.mocked(sync.enqueueLeaderGatheringEnd).mock.calls[0][1]?.navigationSessionId)
    .toBe('server-session-u');
});

it('keeps delayed commands bound to their original group and does not paint them into a new group', async () => {
  let release!: (value: any) => void;
  jest.mocked(sync.enqueueLeaderGatheringStart)
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockImplementationOnce(async (groupId, options) => ({ ...saved(options!.activeDestinationId!, 1),
      local: { ...saved(options!.activeDestinationId!, 1).local, groupId } }) as any);
  await act(async () => { await api.startNavigation(first, 0); });
  await act(async () => { root.update(React.createElement(Harness, { groupId: 'g2' })); });
  await act(async () => { await api.startNavigation(second, 1); });
  await act(async () => { release(saved('a', 1)); });
  expect(jest.mocked(sync.enqueueLeaderGatheringStart).mock.calls.map(([groupId]) => groupId)).toEqual(['g', 'g2']);
  expect(jest.mocked(sync.enqueueLeaderGatheringStart).mock.calls[1][1]?.baseState?.groupId).toBe('g2');
  expect(projection.mock.calls.map(([value]) => value.groupId)).toEqual(['g2']);
  expect(api.navTargetId).toBe('b');
});

it('reports local storage failure without claiming a saved journey or starting the server', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockRejectedValueOnce(new Error('SQLITE_FULL'));
  await act(async () => { await api.startNavigation(first, 0); });
  expect(projection).not.toHaveBeenCalled();
  expect(api.navTargetId).toBeNull();
  expect(showOperationFailure).toHaveBeenCalledWith('map.setFailedTitle', 'local storage failed');
  expect(startSession).not.toHaveBeenCalled();
});

it('reports End local storage failure explicitly and does not claim a saved command', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('a', 1) as any);
  await act(async () => { await api.startNavigation(first, 0); });
  expect(api.navTargetId).toBe('a');
  let reject!: (error: Error) => void;
  jest.mocked(sync.enqueueLeaderGatheringEnd).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  let pending!: Promise<boolean>;
  await act(async () => { pending = api.stopNavigation(); });
  expect(api.navTargetId).toBeNull();
  expect(api.journeyActive).toBe(false);
  let success: boolean | undefined;
  await act(async () => { reject(new Error('storage unavailable')); success = await pending; });
  expect(success).toBe(false);
  expect(Alert.alert).toHaveBeenCalledWith('map.setFailedTitle', 'local storage failed');
  expect(showAppNotice).not.toHaveBeenCalled();
  expect(api.navTargetId).toBeNull();
  expect(api.journeyActive).toBe(false);
});

it('keeps a saved End successful and silent when backend delivery fails', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('a', 1) as any);
  await act(async () => { await api.startNavigation(first, 0); });
  jest.mocked(sync.enqueueLeaderGatheringEnd).mockResolvedValue(saved(null, 2) as any);
  jest.mocked(sync.flushCoreOperationOutbox).mockRejectedValueOnce(new Error('offline'));
  let success: boolean | undefined;
  await act(async () => { success = await api.stopNavigation(); });
  expect(success).toBe(true);
  expect(api.navTargetId).toBeNull();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(showAppNotice).not.toHaveBeenCalled();
});

it('stops a durably deleted target without creating a separate End command', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('a', 1) as any);
  await act(async () => { await api.startNavigation(first, 0); });
  await act(async () => { api.stopRemovedDestination('b', 'unrelated'); });
  expect(api.navTargetId).toBe('a');
  await act(async () => { api.stopRemovedDestination('a', 'op-1'); });
  expect(api.navTargetId).toBeNull();
  expect(sync.enqueueLeaderGatheringEnd).not.toHaveBeenCalled();
  expect(cancelSession).not.toHaveBeenCalled();
  expect(localSessionChanges.at(-1)).toBeNull();
});

it('resumes the same server session when terminal rejection restores a deleted target', async () => {
  const navigationSession: NavigationSession = { id: 'original', groupId: 'g', destinationId: 'a',
    destination: { name: 'A', coordinates: first.coordinates, arrivalRadiusMeters: 50 },
    startedBy: 'leader', requestId: 'original', startedAt: new Date().toISOString(),
    expiresAt: '2099-01-01T00:00:00Z', status: 'active', version: 1 };
  await act(async () => { root.update(React.createElement(Harness, { navigationSession })); });
  expect(api.navTargetId).toBe('a');
  await act(async () => {
    root.update(React.createElement(Harness, { navigationSession,
      groupState: { ...state, destinations: [second] } }));
    api.stopRemovedDestination('a', 'original');
  });
  expect(api.navTargetId).toBeNull();
  await act(async () => { root.update(React.createElement(Harness, {
    navigationSession, hasPendingTeamOperation: false, groupState: state,
  })); });
  expect(api.navTargetId).toBe('a');
  expect(api.journeyActive).toBe(true);
});
