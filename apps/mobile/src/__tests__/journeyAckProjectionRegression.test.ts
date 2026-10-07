import React from 'react';
import type { Destination, GroupState } from '../types';
import type { NavigationSession } from '../types/navigation';
import type { ActiveGatheringState } from '../types/coreData';
type JourneyProjection = { canonicalDestinationId: string; gathering: ActiveGatheringState };
const mockProjection = jest.fn(async (): Promise<JourneyProjection | null> => null);
const mockStart = jest.fn();
const mockEnd = jest.fn();
const mockOperation = jest.fn(async () => null);
const mockFlush = jest.fn(async () => undefined);
jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'local-start' }));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn() }));
jest.mock('../utils/operationError', () => ({ getOperationErrorMessage: () => 'test failure' }));
jest.mock('../state/appNotice', () => ({ showOperationFailure: jest.fn() }));
jest.mock('../native/externalNavigation', () => ({ presentExternalMapsChooser: jest.fn() }));
jest.mock('../state/endedNavigationSessions', () => ({
  legacyNavigationSessionKey: (at: string, destinationId: string) => `${at}:${destinationId}`,
  readEndedNavigationSessions: jest.fn(async () => []),
  rememberEndedNavigationSession: jest.fn(async () => undefined),
}));
jest.mock('../state/coreDataSync', () => ({
  enqueueLeaderGatheringStart: (...args: unknown[]) => mockStart(...args),
  enqueueLeaderGatheringSwitch: (...args: unknown[]) => mockStart(...args),
  enqueueLeaderGatheringEnd: (...args: unknown[]) => mockEnd(...args),
  flushCoreOperationOutbox: () => mockFlush(),
  getCoreOperationOutbox: () => ({ getOperation: () => mockOperation() }),
  readLocalJourneyProjection: () => mockProjection(),
}));
import { useJourneyNavigation } from '../screens/MapScreen/hooks/useJourneyNavigation';
const { act, create } = require('react-test-renderer');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const destination: Destination = { id: 'new-place', title: 'Quick added place', order: 0,
  day: 1, coordinates: { latitude: 25.01, longitude: 121.02 } };
const startedAt = '2026-10-08T08:00:00Z';
const gathering: ActiveGatheringState = { groupId: 'g', journeyPhase: 'en_route', activeDestinationId: destination.id,
  pointStatuses: { [destination.id]: 'en_route' }, phaseChangedAt: Date.parse(startedAt), entityVersion: 1 };
const groupState = (going = false): GroupState => ({
  group: { id: 'g', name: 'Trip', inviteCode: 'QAONLY', createdBy: 'actor-a', stragglerAlerts: false, stragglerThresholdM: 200, journeyStatus: going ? 'going' : 'paused',
    activeDestinationId: destination.id, ...(going ? { journeyStartedAt: startedAt } : {}) },
  destinations: [destination], members: [], subgroups: [], nextDestination: destination,
} as GroupState);
const serverSession: NavigationSession = { id: 'server-row', groupId: 'g', destinationId: destination.id,
  destination: { name: destination.title, coordinates: destination.coordinates, arrivalRadiusMeters: 50 },
  startedBy: 'actor-a', requestId: 'local-start', startedAt, expiresAt: '2026-10-08T16:00:00Z',
  status: 'active', version: 1 };
const noop = () => undefined;
const mapRef = { current: null };
const carouselRef = { current: null };
let api: ReturnType<typeof useJourneyNavigation>;
let renderer: { update: (node: React.ReactElement) => void; unmount: () => void };
function Harness({ state = groupState(), pending = true, session = null }: {
  state?: GroupState; pending?: boolean; session?: NavigationSession | null;
}) {
  const [, setLocalSessionId] = React.useState<string | null>(null);
  const next = useJourneyNavigation({ state, groupId: 'g', actorId: 'actor-a', isLeader: true,
    destinations: state.destinations, selectedDestination: destination, fromCoords: undefined,
    refresh: noop, t: key => key, mapRef, carouselRef, setSelectedIndex: noop,
    navigationSession: session, hasPendingTeamOperation: pending, onLocalSessionIdChange: setLocalSessionId });
  React.useLayoutEffect(() => { api = next; });
  return null;
}
beforeEach(async () => {
  jest.clearAllMocks();
  mockProjection.mockReset().mockResolvedValue({ canonicalDestinationId: destination.id, gathering });
  mockStart.mockResolvedValue({ local: gathering, base: { ...gathering, journeyPhase: 'staying', entityVersion: 0 }, operationId: 'local-start' });
  mockEnd.mockResolvedValue({ local: { ...gathering, journeyPhase: 'staying', entityVersion: 2 } });
  await act(async () => { renderer = create(React.createElement(Harness)); });
});
afterEach(async () => { await act(async () => { renderer.unmount(); }); });

it('keeps quick-add Start going after a delayed ACK until the separate session projection becomes visible', async () => {
  // The newly added local card exists, but no server session row has arrived.
  await act(async () => { await api.startNavigation(destination, 0); });
  expect(api.journeyActive).toBe(true);
  await act(async () => { renderer.update(React.createElement(Harness, { state: groupState(true) })); });
  expect(api.navTargetId).toBe(destination.id);
  // Simulate the durable Start being removed on ACK several seconds later.
  // Group projection is current; the independent session subscription is late.
  await act(async () => { renderer.update(React.createElement(Harness, { state: groupState(true), pending: false })); });
  expect(api.journeyActive).toBe(true);
  expect(api.journeyStatus).toBe('going');
  expect(api.navTargetId).toBe(destination.id);
  expect(mockEnd).not.toHaveBeenCalled();
  // Unrelated renders / stale null session reads must not silently pause it.
  for (let index = 0; index < 3; index += 1) {
    await act(async () => { renderer.update(React.createElement(Harness, { state: groupState(true), pending: false })); });
    expect(api.journeyActive).toBe(true);
  }
  await act(async () => { renderer.update(React.createElement(Harness, { state: groupState(true), pending: false, session: serverSession })); });
  expect(api.journeyActive).toBe(true);
  expect(api.localSessionId).toBeNull();
  expect(api.navTargetId).toBe(destination.id);
});

it('keeps an explicit local End paused while the delayed Start session projection finally arrives', async () => {
  await act(async () => { await api.startNavigation(destination, 0); });
  await act(async () => { await api.requestTeamEnd(destination, 0); });
  expect(api.journeyActive).toBe(false);
  await act(async () => { renderer.update(React.createElement(Harness, { state: groupState(), pending: false, session: serverSession })); });
  expect(api.journeyActive).toBe(false);
  expect(api.navTargetId).toBeNull();
  expect(mockEnd).toHaveBeenCalledTimes(1);
});

it('keeps the newer End paused when an ACK-triggered local projection read resolves late', async () => {
  await act(async () => { await api.startNavigation(destination, 0); });
  // Start may read the durable base first; this count tracks only the ACK read.
  mockProjection.mockClear();
  let resolveProjection!: (value: JourneyProjection) => void;
  mockProjection.mockImplementationOnce(() => new Promise(resolve => { resolveProjection = resolve; }));
  await act(async () => { renderer.update(React.createElement(Harness, { state: groupState(true), pending: false })); });
  expect(mockProjection).toHaveBeenCalledTimes(1);
  expect(api.journeyActive).toBe(true);
  await act(async () => { await api.requestTeamEnd(destination, 0); });
  expect(api.journeyActive).toBe(false);
  await act(async () => { resolveProjection({ canonicalDestinationId: destination.id, gathering }); });
  expect(api.journeyActive).toBe(false);
  expect(api.navTargetId).toBeNull();
});

it('restores an acknowledged local journey while its session subscription is still loading after map reentry', async () => {
  await act(async () => { renderer.update(React.createElement(Harness, { state: groupState(true), pending: false, session: null })); });
  expect(api.journeyActive).toBe(true);
  expect(api.navTargetId).toBe(destination.id);
  expect(mockStart).not.toHaveBeenCalled();
});

it('does not resurrect stale going group state when a terminal server session is already visible', async () => {
  await act(async () => { renderer.update(React.createElement(Harness, {
    state: groupState(true), pending: false, session: { ...serverSession, status: 'completed' },
  })); });
  expect(api.journeyActive).toBe(false);
  expect(api.navTargetId).toBeNull();
});

it('stops a deleted quick-added target without following an unrelated selected card', async () => {
  await act(async () => { await api.startNavigation(destination, 0); });
  const remaining = { ...destination, id: 'unrelated-card', title: 'Unrelated' };
  await act(async () => { renderer.update(React.createElement(Harness, {
    state: { ...groupState(true), destinations: [remaining], nextDestination: remaining }, pending: false,
  })); });
  expect(api.journeyActive).toBe(false);
  expect(api.navTargetId).toBeNull();
  expect(mockStart).toHaveBeenCalledTimes(1);
});
