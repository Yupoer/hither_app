const mockNavigationDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockNavigationDisk.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockNavigationDisk.set(key, value); }),
} }));
jest.mock('../state/appNotice', () => ({ showOperationFailure: jest.fn(), showAppNotice: jest.fn() }));
import { rememberEndedNavigationSession } from '../state/endedNavigationSessions';
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
  readLocalJourneyProjection: (...args: unknown[]) => mockLocalProjection(...args),
}));
const mockLocalProjection = jest.fn(async (..._args: unknown[]): Promise<any> => null);
const mockGetOperation = jest.fn(async (): Promise<unknown> => ({ status: 'pending' }));
import React from 'react';
import { Alert } from 'react-native';
import { useJourneyNavigation } from '../screens/MapScreen/hooks/useJourneyNavigation';
import * as sync from '../state/coreDataSync';
import type { Coordinates, Destination, GroupState } from '../types';
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
function Harness({ groupId = 'g', actorId, navigationSession = null, terminalSession = null, groupState, hasPendingTeamOperation = true,
  camera, origin }: {
  groupId?: string;
  actorId?: string;
  terminalSession?: NavigationSession | null;
  navigationSession?: NavigationSession | null;
  groupState?: GroupState;
  hasPendingTeamOperation?: boolean;
  camera?: { fitRoute: jest.Mock; centerOn: jest.Mock };
  origin?: Coordinates;
}) {
  const currentState = groupState ?? (groupId === 'g' ? state : { ...state, group: { ...state.group, id: groupId } });
  const currentApi = useJourneyNavigation({ state: currentState, groupId, actorId, terminalSession, isLeader: true, destinations: currentState.destinations,
    selectedDestination: first, fromCoords: origin, refresh: jest.fn(),
    t: (key, params) => params ? `${key}:${params.currentName}:${params.newName}` : key,
    mapRef: { current: camera as any ?? null }, carouselRef: { current: null }, setSelectedIndex: jest.fn(),
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
  mockLocalProjection.mockResolvedValue(null);
  await act(async () => { root = create(React.createElement(Harness)); });
});
afterEach(async () => { await act(async () => root.unmount()); });

it('names the active and requested stops before switching; cancel preserves the old journey', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('a', 1) as any);
  jest.mocked(sync.enqueueLeaderGatheringSwitch).mockResolvedValue(saved('b', 2) as any);
  await act(async () => { await api.startNavigation(first, 0); });
  await act(async () => { await api.startNavigation(second, 1); });
  expect(Alert.alert).toHaveBeenLastCalledWith('map.switchJourneyTitle', 'map.switchJourneyMessage:A:B', expect.any(Array), expect.any(Object));
  expect(api.navTargetId).toBe('a');
  expect(sync.enqueueLeaderGatheringSwitch).not.toHaveBeenCalled();
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  await act(async () => { await api.startNavigation(second, 1); });
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(buttons[0]?.style).toBe('cancel');
  await act(async () => { buttons[0]?.onPress?.(); });
  expect(api.navTargetId).toBe('a');
  expect(state.destinations.map(d => d.id)).toEqual(['a', 'b']);
  await act(async () => { await api.startNavigation(second, 1); });
  await act(async () => { jest.mocked(Alert.alert).mock.calls.at(-1)![2]![1]?.onPress?.(); });
  expect(sync.enqueueLeaderGatheringSwitch).toHaveBeenCalledWith('g', expect.objectContaining({
    activeDestinationId: 'b', navigationRequestId: 'operation-id', promoteWithinDay: true,
  }));
  expect(api.navTargetId).toBe('b');
});

it('prompts for a suppressed prior server target and commits a switch after confirmation', async () => {
  const old: NavigationSession = { id: 'suppressed-old', groupId: 'g', destinationId: 'a', status: 'active',
    destination: { name: 'Previous named stop', coordinates: first.coordinates, arrivalRadiusMeters: 50 },
    startedAt: '2026-10-01T00:00:00Z', requestId: 'suppressed-request', startedBy: 'leader',
    expiresAt: '2027-01-01T00:00:00Z', version: 1 };
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: old })); });
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: old,
    terminalSession: { ...old, status: 'cancelled', version: 2 } })); });
  expect(api.navTargetId).toBeNull();
  jest.mocked(sync.enqueueLeaderGatheringSwitch).mockResolvedValue(saved('b', 1) as any);
  await act(async () => { await api.startNavigation(second, 1); });
  expect(Alert.alert).toHaveBeenLastCalledWith('map.switchJourneyTitle', 'map.switchJourneyMessage:A:B', expect.any(Array), expect.any(Object));
  await act(async () => { jest.mocked(Alert.alert).mock.calls.at(-1)![2]![1]?.onPress?.(); });
  expect(sync.enqueueLeaderGatheringSwitch).toHaveBeenCalled();
  expect(api.navTargetId).toBe('b');
});

it('protects a new Start from an old terminal row while its SQLite save is still pending', async () => {
  const old: NavigationSession = { id: 'old-precommit', groupId: 'g', destinationId: 'a', status: 'active',
    destination: { name: 'A', coordinates: first.coordinates, arrivalRadiusMeters: 50 },
    startedAt: '2026-10-01T00:00:00Z', requestId: 'old-precommit-request', startedBy: 'leader',
    expiresAt: '2027-01-01T00:00:00Z', version: 1 };
  let release!: (value: any) => void;
  jest.mocked(sync.enqueueLeaderGatheringSwitch).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: old })); });
  await act(async () => { await api.startNavigation(second, 1); });
  await act(async () => { jest.mocked(Alert.alert).mock.calls.at(-1)![2]![1]?.onPress?.(); });
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: old,
    terminalSession: { ...old, status: 'cancelled', version: 2 } })); });
  expect(api.navTargetId).toBe('b');
  await act(async () => { release(saved('b', 1)); });
  expect(api.navTargetId).toBe('b');
});

it('keeps a same-target restart visible while the old active row and dismissal are still cached', async () => {
  const old: NavigationSession = { id: 'same-target-old', groupId: 'g', destinationId: 'a', status: 'active',
    destination: { name: 'A', coordinates: first.coordinates, arrivalRadiusMeters: 50 },
    startedAt: '2026-10-01T00:00:00Z', requestId: 'same-target-old-request', startedBy: 'leader',
    expiresAt: '2027-01-01T00:00:00Z', version: 1 };
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: old })); });
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: old,
    terminalSession: { ...old, status: 'cancelled', version: 2 } })); });
  let release!: (value: any) => void;
  jest.mocked(sync.enqueueLeaderGatheringStart).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { await api.startNavigation(first, 0); });
  expect(api.navTargetId).toBe('a');
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: old,
    terminalSession: { ...old, status: 'cancelled', version: 2 } })); });
  expect(api.navTargetId).toBe('a');
  await act(async () => { release(saved('a', 1)); });
  expect(api.navTargetId).toBe('a');
  expect(api.localSessionId).toBe('op-1');
});

it('does not let the previous local Start terminal cancel a newer queued switch', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('a', 1) as any);
  await act(async () => { await api.startNavigation(first, 0); });
  let release!: (value: any) => void;
  jest.mocked(sync.enqueueLeaderGatheringSwitch).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { await api.startNavigation(second, 1); });
  await act(async () => { jest.mocked(Alert.alert).mock.calls.at(-1)![2]![1]?.onPress?.(); });
  const terminal: NavigationSession = { id: 'previous-local-session', groupId: 'g', destinationId: 'a', status: 'cancelled',
    destination: { name: 'A', coordinates: first.coordinates, arrivalRadiusMeters: 50 },
    startedAt: '2026-10-01T00:00:00Z', requestId: 'op-1', startedBy: 'leader',
    expiresAt: '2027-01-01T00:00:00Z', version: 2 };
  await act(async () => { root.update(React.createElement(Harness, { terminalSession: terminal })); });
  expect(api.navTargetId).toBe('b');
  await act(async () => { release(saved('b', 2)); });
  expect(api.navTargetId).toBe('b');
});

it('frames the device and destination once, including after a missing GPS fix returns', async () => {
  const camera = { fitRoute: jest.fn(), centerOn: jest.fn() };
  const origin = { latitude: 24, longitude: 120 };
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('b', 1) as any);
  await act(async () => { root.update(React.createElement(Harness, { camera })); });
  await act(async () => { await api.startNavigation(second, 1); });
  expect(camera.centerOn).toHaveBeenCalledTimes(1);
  expect(camera.fitRoute).not.toHaveBeenCalled();
  const reordered = { ...state, destinations: [{ ...second, order: 0 }, { ...first, order: 1 }] };
  await act(async () => { root.update(React.createElement(Harness, { camera, origin, groupState: reordered })); });
  expect(camera.fitRoute).toHaveBeenCalledTimes(1);
  expect(camera.fitRoute).toHaveBeenCalledWith([origin, second.coordinates]);
  expect(camera.centerOn).toHaveBeenCalledTimes(1);
  await act(async () => { root.update(React.createElement(Harness, { camera, origin: { latitude: 24.1, longitude: 120.1 }, groupState: reordered })); });
  expect(camera.fitRoute).toHaveBeenCalledTimes(1);
  expect(camera.centerOn).toHaveBeenCalledTimes(1);
});

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
  await act(async () => { (jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1] as any).onPress(); });
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

it('keeps an acknowledged local Start while the recovery projection still has no navigation session', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('b', 1) as any);
  await act(async () => { await api.startNavigation(second, 1); });
  mockGetOperation.mockResolvedValue(null);
  await act(async () => { root.update(React.createElement(Harness, {
    hasPendingTeamOperation: false, navigationSession: null,
    groupState: { ...state, group: { ...state.group, journeyStatus: 'going', activeDestinationId: 'b' } },
  })); });
  expect(api.navTargetId).toBe('b');
  expect(api.journeyGoing).toBe(true);
  expect(api.localSessionId).toBe('op-1');
  await act(async () => { root.update(React.createElement(Harness, {
    hasPendingTeamOperation: false, navigationSession: null,
    // A late read can still expose the old paused group while session hydration
    // is catching up. The accepted local command must survive that projection.
    groupState: state,
  })); });
  expect(api.navTargetId).toBe('b');
  expect(api.localSessionId).toBe('op-1');
});

it('still releases a rejected Start instead of keeping its optimistic journey forever', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('b', 1) as any);
  await act(async () => { await api.startNavigation(second, 1); });
  mockGetOperation.mockResolvedValue({ status: 'conflict' });
  await act(async () => { root.update(React.createElement(Harness, {
    hasPendingTeamOperation: false, navigationSession: null, groupState: state,
  })); });
  expect(api.navTargetId).toBeNull();
  expect(api.journeyGoing).toBe(false);
  expect(api.localSessionId).toBeNull();
});

it('stops on a newer durable End even when the session subscription still returns an old active row', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('b', 1) as any);
  await act(async () => { await api.startNavigation(second, 1); });
  mockGetOperation.mockResolvedValue(null);
  mockLocalProjection.mockResolvedValue({ canonicalDestinationId: 'b',
    gathering: { ...base, entityVersion: 2, phaseChangedAt: 10 } });
  const oldSession: NavigationSession = { id: 'old-row', groupId: 'g', destinationId: second.id,
    destination: { name: second.title, coordinates: second.coordinates, arrivalRadiusMeters: 50 },
    startedBy: 'leader', requestId: 'old-request', startedAt: '1970-01-01T00:00:00Z',
    expiresAt: '2027-01-01T00:00:00Z', status: 'active', version: 1 };
  await act(async () => { root.update(React.createElement(Harness, { hasPendingTeamOperation: false,
    navigationSession: oldSession, groupState: state })); });
  expect(api.journeyGoing).toBe(false);
  expect(api.navTargetId).toBeNull();
  expect(api.localSessionId).toBeNull();
  // An unrelated render with stale going state must not erase durable End2.
  await act(async () => { root.update(React.createElement(Harness, { hasPendingTeamOperation: false,
    navigationSession: oldSession, groupState: { ...state, group: { ...state.group,
      journeyStatus: 'going', activeDestinationId: 'b', journeyStartedAt: oldSession.startedAt } } })); });
  jest.mocked(sync.enqueueLeaderGatheringStart).mockImplementationOnce(async (_group, options) => {
    expect(options?.baseState).toMatchObject({ journeyPhase: 'staying', entityVersion: 2 });
    return { ...saved('b', 3), base: options?.baseState } as any;
  });
  await act(async () => { await api.startNavigation(second, 1); });
  expect(projection.mock.calls.at(-1)?.[0]).toMatchObject({ journeyPhase: 'en_route', entityVersion: 3 });
});

it('follows the proven canonical quick-add identity without losing the local Start alias', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('b', 1) as any);
  await act(async () => { await api.startNavigation(second, 1); });
  const canonical = { ...second, id: 'canonical-b' };
  mockLocalProjection.mockResolvedValue({ canonicalDestinationId: canonical.id,
    gathering: { ...saved(canonical.id, 1).local } });
  await act(async () => { root.update(React.createElement(Harness, { hasPendingTeamOperation: true,
    groupState: { ...state, destinations: [first, canonical] } })); });
  expect(api.navTargetId).toBe(canonical.id);
  expect(api.journeyActive).toBe(true);
  expect(api.localSessionId).toBe('op-1');
});

it('stops a removed destination when no canonical merge ledger exists', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValue(saved('b', 1) as any);
  await act(async () => { await api.startNavigation(second, 1); });
  mockLocalProjection.mockResolvedValue({ canonicalDestinationId: 'b', gathering: saved('b', 1).local });
  await act(async () => { root.update(React.createElement(Harness, { hasPendingTeamOperation: false,
    groupState: { ...state, destinations: [first] } })); });
  expect(api.navTargetId).toBeNull();
  expect(api.journeyGoing).toBe(false);
  expect(api.localSessionId).toBeNull();
});

it('stops on an explicit terminal row and ignores that tombstone for a later local Start', async () => {
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValueOnce(saved('b', 1) as any)
    .mockResolvedValueOnce(saved('b', 3) as any);
  const serverSession: NavigationSession = { id: 'current-row', groupId: 'g', destinationId: second.id,
    destination: { name: second.title, coordinates: second.coordinates, arrivalRadiusMeters: 50 },
    startedBy: 'leader', requestId: 'op-1', startedAt: '2026-10-08T08:00:00Z',
    expiresAt: '2027-01-01T00:00:00Z', status: 'active', version: 1 };
  const goingState = { ...state, group: { ...state.group, journeyStatus: 'going', activeDestinationId: 'b', journeyStartedAt: serverSession.startedAt } } as GroupState;
  await act(async () => { await api.startNavigation(second, 1); });
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: serverSession, groupState: goingState })); });
  const terminal = { ...serverSession, status: 'cancelled', version: 2 } as NavigationSession;
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: null, terminalSession: terminal,
    hasPendingTeamOperation: false, groupState: goingState })); });
  expect(api.navTargetId).toBeNull();
  await act(async () => { await api.startNavigation(second, 1); });
  expect(api.journeyGoing).toBe(true);
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: null, terminalSession: { ...terminal },
    hasPendingTeamOperation: false, groupState: goingState })); });
  expect(api.navTargetId).toBe('b');
  const replacement = { ...serverSession, id: 'new-row', requestId: 'op-3', startedAt: '2026-10-08T09:00:00Z' };
  // The current session's identity wins even while group recovery still carries
  // the dismissed previous session's legacy startedAt for the same stop.
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: replacement,
    terminalSession: null, hasPendingTeamOperation: false, groupState: goingState })); });
  expect(api.navTargetId).toBe('b');
  expect(api.journeyGoing).toBe(true);
});

it('hands a settled same-stop Start to a newer server UUID even when the device clock is ahead', async () => {
  const old: NavigationSession = { id: 'previous-clock-row', groupId: 'g', destinationId: second.id,
    destination: { name: second.title, coordinates: second.coordinates, arrivalRadiusMeters: 50 },
    startedBy: 'leader', requestId: 'previous-clock-request', startedAt: '2026-10-08T08:00:00Z',
    expiresAt: '2027-01-01T00:00:00Z', status: 'active', version: 1 };
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: old })); });
  jest.mocked(sync.enqueueLeaderGatheringEnd).mockResolvedValueOnce(saved(null, 2) as any);
  await act(async () => { await api.requestTeamEnd(second, 1); });
  const futureStart = saved('b', 3);
  futureStart.local.phaseChangedAt = Date.parse('2099-01-01T00:00:00Z');
  jest.mocked(sync.enqueueLeaderGatheringStart).mockResolvedValueOnce(futureStart as any);
  await act(async () => { await api.startNavigation(second, 1); });
  mockGetOperation.mockResolvedValue(null);
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: old, hasPendingTeamOperation: false })); });
  expect(api.localSessionId).toBe('op-3');
  const replacement = { ...old, id: 'replacement-clock-row', requestId: 'other-device-request',
    startedAt: '2026-10-08T09:00:00Z' };
  await act(async () => { root.update(React.createElement(Harness, { navigationSession: replacement, hasPendingTeamOperation: false })); });
  expect(api.localSessionId).toBeNull();
  expect(api.navTargetId).toBe('b');
  expect(api.journeyActive).toBe(true);
});

it('keeps a terminal session dismissed after remount while its cached group still says going', async () => {
  const actorId = 'terminal-remount-actor';
  const active: NavigationSession = { id: 'dismissed-server-row', groupId: 'g', destinationId: second.id,
    destination: { name: second.title, coordinates: second.coordinates, arrivalRadiusMeters: 50 },
    startedBy: actorId, requestId: 'dismissed-request', startedAt: '2026-10-08T08:00:00Z',
    expiresAt: '2027-01-01T00:00:00Z', status: 'active', version: 1 };
  const goingState = { ...state, group: { ...state.group, journeyStatus: 'going', activeDestinationId: 'b',
    journeyStartedAt: active.startedAt } } as GroupState;
  await act(async () => { root.update(React.createElement(Harness, { actorId, navigationSession: active, groupState: goingState })); });
  await act(async () => { root.update(React.createElement(Harness, { actorId, navigationSession: null,
    terminalSession: { ...active, status: 'cancelled', version: 2 }, groupState: goingState })); });
  expect(api.journeyGoing).toBe(false);
  // Drain the same persistence chain before simulating screen reentry.
  await rememberEndedNavigationSession(actorId, 'g', 'test-write-barrier');
  await act(async () => { root.unmount(); root = create(React.createElement(Harness, {
    actorId, navigationSession: null, hasPendingTeamOperation: false, groupState: goingState,
  })); });
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
    (jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1] as any).onPress();
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
