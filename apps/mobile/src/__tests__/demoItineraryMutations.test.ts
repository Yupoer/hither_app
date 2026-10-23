import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { DEMO_GROUP_ID, demoAddDestination, demoDeleteDestination, getDemoState } from '../api/demo';
import { deleteDestination, reorderDestinations } from '../api/services/DestinationService';
import { supabase } from '../api/supabase';
import { useItineraryMutations } from '../screens/MapScreen/hooks/useItineraryMutations';
import { useRouteDraft } from '../screens/MapScreen/hooks/useRouteDraft';
import { resetUiActionStateForTests } from '../utils/uiAction';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../api/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('../api/client', () => jest.requireActual('../api/services/DestinationService'));
jest.mock('../api/services/DailyAccommodationService', () => ({
  resolveDailyAccommodationSourceId: (id: string | undefined) => id,
}));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn(), logError: jest.fn() }));
jest.mock('../utils/confirm', () => ({ confirmAction: (_options: unknown, confirm: () => void) => confirm() }));
const mockCore = {
  ensureCoreSnapshot: jest.fn(),
  enqueueDestinationDelete: jest.fn(),
  enqueueDestinationReorder: jest.fn(),
};
jest.mock('../state/coreDataSync', () => mockCore);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('demo itinerary service and clean route draft', () => {
  let api: ReturnType<typeof useItineraryMutations>;
  let draft: ReturnType<typeof useRouteDraft>;
  let renderer: ReactTestRenderer | undefined;
  let a: string;
  let b: string;
  let refreshDemo: () => Promise<boolean>;
  const refreshLocalSnapshot = jest.fn(async () => true);
  const showOperationFailure = jest.fn();

  function Harness() {
    const [snapshot, setSnapshot] = useState(getDemoState);
    const server = snapshot.destinations;
    const refresh = async () => { setSnapshot(getDemoState()); return true; };
    refreshDemo = refresh;
    draft = useRouteDraft({
      scopeId: undefined, rawDestinations: server, serverDestinations: server,
      serverDaily: [], group: snapshot.group, openOperations: [],
    });
    api = useItineraryMutations({
      allScopedDestinations: draft.destinations ?? server, canEditItinerary: true,
      destinations: server, group: snapshot.group, groupId: DEMO_GROUP_ID,
      isWorkflowContextCurrent: () => true, markLeaderRevoked: jest.fn(),
      navTargetId: null, rawDestinations: server, refresh,
      refreshKmlQuota: jest.fn(async () => undefined), refreshLocalSnapshot,
      resolveCurrentNavigationSessionId: () => null, routeDepartureDate: '2026-11-01',
      routeDraft: draft, routeEditorServerDestinations: draft.editorServerDestinations,
      routeTripDays: 2, serverDailyAccommodations: [], setKmlScopeId: jest.fn(),
      setKmlVisible: jest.fn(), setRouteSelectedIds: jest.fn(), showOperationFailure,
      stopRemovedDestination: jest.fn(), t: key => key, workflowContext: 'demo',
    });
    return React.createElement(React.Fragment, null, draft.lifecycle, React.createElement('div', null,
      (draft.destinations ?? server).map(destination => destination.title).join(',')));
  }

  async function renderCleanEditor() {
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { draft.openEditor(undefined, getDemoState().destinations); });
    expect(draft.latestDestinations()).toBeNull();
    expect(renderer?.root.findByType('div').children).toEqual(['a,b']);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    resetUiActionStateForTests();
    for (const destination of getDemoState().destinations) demoDeleteDestination(destination.id);
    const coordinates = { latitude: 25, longitude: 121 };
    a = demoAddDestination({ title: 'a', day: 1, coordinates });
    b = demoAddDestination({ title: 'b', day: 1, coordinates });
  });

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
    for (const method of Object.values(mockCore)) expect(method).not.toHaveBeenCalled();
  });

  it('deletes from the actual demo service snapshot', async () => {
    await deleteDestination(DEMO_GROUP_ID, a);
    expect(getDemoState().destinations.map(destination => destination.id)).toEqual([b]);
  });

  it('reorders and patches demo metadata without dropping unmentioned subgroup stops', async () => {
    const sub = demoAddDestination({ title: 'sub', day: 1, subgroupId: 'sub', coordinates: { latitude: 25, longitude: 121 } });
    const untouched = getDemoState().destinations.find(destination => destination.id === sub);
    await reorderDestinations(DEMO_GROUP_ID, [
      { id: b, position: 0, day: 2, meetAt: '2026-11-02T08:00:00Z', stayAnchor: true },
      { id: a, position: 1, day: null, stayAnchor: false },
    ]);
    expect(getDemoState().destinations.filter(destination => !destination.subgroupId)).toMatchObject([
      { id: b, order: 0, day: 2, meetAt: '2026-11-02T08:00:00Z', stayAnchor: true },
      { id: a, order: 1, day: null, stayAnchor: false },
    ]);
    expect(getDemoState().destinations.find(destination => destination.id === sub)).toEqual(untouched);
    await reorderDestinations(DEMO_GROUP_ID, [{ id: b, position: 0, day: 2, stayAnchor: false }]);
    expect(getDemoState().destinations.find(destination => destination.id === b)).toMatchObject({
      meetAt: '2026-11-02T08:00:00Z', stayAnchor: false,
    });
  });

  it('renders b after confirming deletion of a with no draft overlay', async () => {
    await renderCleanEditor();
    await act(async () => { api.handleDelete(a); });
    expect(renderer?.root.findByType('div').children).toEqual(['b']);
    expect(draft.latestDestinations()).toBeNull();
    expect(refreshLocalSnapshot).not.toHaveBeenCalled();
    expect(showOperationFailure).not.toHaveBeenCalled();
  });

  it('renders b,a after a saved reorder and a subsequent demo refresh', async () => {
    await renderCleanEditor();
    let result: boolean | undefined;
    await act(async () => {
      result = await api.handleReorder([{ id: b, position: 0, day: 1 }, { id: a, position: 1, day: 1 }]);
    });
    expect(result).toBe(true);
    expect(renderer?.root.findByType('div').children).toEqual(['b,a']);
    expect(getDemoState().destinations.map(destination => destination.id)).toEqual([b, a]);
    await act(async () => { await refreshDemo(); });
    expect(renderer?.root.findByType('div').children).toEqual(['b,a']);
    expect(draft.latestDestinations()).toBeNull();
    expect(showOperationFailure).not.toHaveBeenCalled();
  });
});
