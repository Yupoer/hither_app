import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Destination, Group } from '../types';

const mockCalls: string[] = [];
const record = (name: string) => jest.fn(async (...args: unknown[]) => {
  mockCalls.push(`${name}:${JSON.stringify(args.slice(1))}`);
  return name === 'addDestination' ? `real-${mockCalls.length}` : undefined;
});
const mockApi = {
  addDestination: record('addDestination'),
  clearDailyAccommodation: record('clearDailyAccommodation'),
  deleteDestination: record('deleteDestination'),
  reorderDestinations: record('reorderDestinations'),
  setDailyAccommodation: record('setDailyAccommodation'),
  updateDestinationEmojiColor: record('updateDestinationEmojiColor'),
  updateGroupTripDetails: record('updateGroupTripDetails'),
};
const mockAlert = jest.fn();

jest.mock('react-native', () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));
jest.mock('../api/client', () => mockApi);
jest.mock('../api/services/DailyAccommodationService', () => ({
  resolveDailyAccommodationSourceId: (id: string | undefined) => id,
}));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn(), logError: jest.fn() }));
jest.mock('../utils/confirm', () => ({ confirmAction: (_opts: unknown, onConfirm: () => void) => onConfirm() }));

import { useItineraryMutations, type UseItineraryMutationsInput } from '../screens/MapScreen/hooks/useItineraryMutations';
import { useRouteDraft } from '../screens/MapScreen/hooks/useRouteDraft';
import { resetUiActionStateForTests } from '../utils/uiAction';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stop = (id: string, order: number, overrides: Partial<Destination> = {}): Destination =>
  ({ id, title: id, order, day: 1, coordinates: { latitude: 25, longitude: 121 }, ...overrides });
const group = { id: 'g1', name: 'Trip', inviteCode: 'X', tripDays: 2, departureDate: '2026-11-01' } as Group;

describe('useItineraryMutations', () => {
  let api: ReturnType<typeof useItineraryMutations> | undefined;
  let draft: ReturnType<typeof useRouteDraft> | undefined;
  let renderer: ReactTestRenderer | undefined;
  const refresh = jest.fn(async () => true);
  const refreshLocalSnapshot = jest.fn(async () => true);
  const showOperationFailure = jest.fn();
  const stopRemovedDestination = jest.fn();
  const server = [stop('a', 0), stop('b', 1), stop('c', 2)];

  function Harness({ overrides }: { overrides: Partial<UseItineraryMutationsInput> }) {
    draft = useRouteDraft({
      scopeId: undefined, rawDestinations: server, serverDestinations: server, serverDaily: [], group, openOperations: [],
    });
    api = useItineraryMutations({
      allScopedDestinations: draft.destinations ?? server,
      canEditItinerary: true,
      destinations: server,
      group,
      groupId: 'g1',
      isWorkflowContextCurrent: () => true,
      markLeaderRevoked: jest.fn(),
      navTargetId: 'c',
      rawDestinations: server,
      refresh,
      refreshKmlQuota: jest.fn(async () => undefined),
      refreshLocalSnapshot,
      resolveCurrentNavigationSessionId: () => 'session-1',
      routeDepartureDate: draft.departureDate,
      routeDraft: draft,
      routeEditorServerDestinations: draft.editorServerDestinations,
      routeTripDays: draft.tripDays,
      serverDailyAccommodations: [],
      setKmlScopeId: jest.fn(),
      setKmlVisible: jest.fn(),
      setRouteSelectedIds: jest.fn(),
      showOperationFailure,
      stopRemovedDestination,
      t: (key) => key,
      workflowContext: 'ctx',
      ...overrides,
    });
    return null;
  }

  async function render(overrides: Partial<UseItineraryMutationsInput> = {}) {
    await act(async () => { renderer = create(React.createElement(Harness, { overrides })); });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockCalls.length = 0;
    resetUiActionStateForTests();
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
  });

  it('saves a reorder of saved stops immediately and keeps no draft copy', async () => {
    await render();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await api?.handleReorder([{ id: 'b', position: 0, day: 1 }, { id: 'a', position: 1, day: 1 }]);
    });
    expect(ok).toBe(true);
    expect(mockCalls).toEqual(['reorderDestinations:[[{"id":"b","position":0,"day":1},{"id":"a","position":1,"day":1}]]']);
    expect(draft?.destinations).toBeNull();
  });

  it('refuses to pool the stop the team is navigating to', async () => {
    await render();
    let ok: boolean | undefined;
    await act(async () => { ok = await api?.handleReorder([{ id: 'c', position: 0, day: null }]); });
    expect(ok).toBe(false);
    expect(showOperationFailure).toHaveBeenCalledWith('map.setFailedTitle', 'trip.endBeforePool');
    expect(mockCalls).toEqual([]);
  });

  it('keeps edits local until flush, then writes trip, deletes, new stops and the final order in that order', async () => {
    await render();
    await act(async () => {
      draft?.setTripDetails(3, '2026-11-02');
      draft?.editDestinations((base) => [...base.filter((d) => d.id !== 'b'), stop('draft-fav-1', 3)]);
      draft?.markDeleted('b');
    });
    expect(mockCalls).toEqual([]);
    await act(async () => { await api?.flushRouteDraft(); });
    expect(mockCalls.map((call) => call.split(':')[0])).toEqual([
      'updateGroupTripDetails', 'deleteDestination', 'addDestination', 'reorderDestinations',
    ]);
    expect(mockCalls[1]).toBe('deleteDestination:["b","session-1"]');
    expect(mockCalls[3]).toContain('"id":"real-3"');
    expect(mockCalls[3]).not.toContain('draft-');
    expect(refreshLocalSnapshot).toHaveBeenCalled();
    expect(draft?.hasUnsavedChanges()).toBe(false);
    expect(draft?.destinations).toBeNull();
  });

  it('keeps the draft visible when a local save fails so the leader can retry', async () => {
    mockApi.updateGroupTripDetails.mockRejectedValueOnce(new Error('disk full'));
    await render();
    await act(async () => { draft?.setTripDetails(3, '2026-11-02'); });
    await act(async () => { await api?.flushRouteDraft(); });
    expect(mockAlert).toHaveBeenCalledWith('map.setFailedTitle', expect.any(String));
    expect(draft?.hasUnsavedChanges()).toBe(true);
  });

  it('deletes confirmed stops one by one and stops their navigation', async () => {
    await render();
    await act(async () => { api?.handleDeleteMany(['a', 'b']); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mockCalls).toEqual(['deleteDestination:["a","session-1"]', 'deleteDestination:["b","session-1"]']);
    expect(stopRemovedDestination.mock.calls).toEqual([['a', 'session-1'], ['b', 'session-1']]);
  });
});
