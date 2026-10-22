import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  insertDraftDestination,
  nextOrderInDay,
  useRouteDraft,
  type UseRouteDraftInput,
} from '../screens/MapScreen/hooks/useRouteDraft';
import { applyReorderUpdates, persistedReorderUpdates } from '../screens/MapScreen/itineraryReorder';
import type { DailyAccommodation, Destination, Group } from '../types';
import type { CoreOperation } from '../types/coreData';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stop(id: string, order: number, overrides: Partial<Destination> = {}): Destination {
  return { id, title: id, order, day: 1, coordinates: { latitude: 25, longitude: 121 }, ...overrides };
}

const group = { id: 'g1', name: 'Trip', inviteCode: 'ABC', tripDays: 2, departureDate: '2026-11-01' } as Group;
const a = stop('a', 0);
const b = stop('b', 1);
const sub = stop('s', 0, { subgroupId: 'sub-1' });
const stay: DailyAccommodation = {
  id: 'stay-1', groupId: 'g1', stayDate: '2026-11-01', title: 'Hotel',
  coordinates: { latitude: 25, longitude: 121 },
};

describe('route draft list helpers', () => {
  it('inserts a draft card inside its day and shifts later cards of that day only', () => {
    const base = [stop('a', 0), stop('b', 1), stop('c', 2), stop('d', 0, { day: 2 })];
    const card = stop('new', nextOrderInDay(base, 1, 0) - 1);
    expect(insertDraftDestination(base, card).map(({ id, order, day }) => `${day}:${id}:${order}`))
      .toEqual(['1:a:0', '1:b:1', '1:new:2', '1:c:3', '2:d:0']);
  });

  it('starts an empty day at the fallback order', () => {
    expect(nextOrderInDay([stop('a', 4)], 2, 7)).toBe(7);
    expect(nextOrderInDay([stop('a', 4), stop('b', 9)], 1, 0)).toBe(10);
  });

  it('moves meet times with their stop when a reorder changes its trip day', () => {
    const meet = '2026-11-01T10:00:00';
    const base = [stop('a', 0, { meetAt: new Date(meet).toISOString() }), stop('b', 1)];
    const moved = applyReorderUpdates(base, [{ id: 'b', position: 0, day: 1 }, { id: 'a', position: 1, day: 2 }],
      '2026-11-01');
    expect(moved.map((destination) => destination.id)).toEqual(['b', 'a']);
    expect(new Date(moved[1].meetAt!).getDate()).toBe(2);
    expect(new Date(moved[1].meetAt!).getHours()).toBe(10);
    const pooled = applyReorderUpdates(base, [{ id: 'a', position: 0, day: null }], '2026-11-01');
    expect(pooled.find((destination) => destination.id === 'a')?.meetAt).toBeUndefined();
  });

  it('writes reorders onto the open itinerary slots, never closed history slots', () => {
    const base = [stop('closed', 0, { closedAt: '2026-11-01T00:00:00Z' }), stop('a', 1), stop('b', 2)];
    expect(persistedReorderUpdates(base, [{ id: 'b', position: 0, day: 1 }, { id: 'a', position: 1, day: 1 }],
      null)).toEqual([{ id: 'b', position: 1, day: 1 }, { id: 'a', position: 2, day: 1 }]);
  });
});

describe('useRouteDraft', () => {
  let draft: ReturnType<typeof useRouteDraft> | undefined;
  let renderer: ReactTestRenderer | undefined;

  function input(overrides: Partial<UseRouteDraftInput> = {}): UseRouteDraftInput {
    return {
      scopeId: undefined,
      rawDestinations: [a, b],
      serverDestinations: [a, b, sub],
      serverDaily: [stay],
      group,
      openOperations: [],
      ...overrides,
    };
  }
  function Harness({ props }: { props: UseRouteDraftInput }) {
    draft = useRouteDraft(props);
    return null;
  }
  function render(props: UseRouteDraftInput) {
    act(() => {
      if (renderer) renderer.update(React.createElement(Harness, { props }));
      else renderer = create(React.createElement(Harness, { props }));
    });
  }
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    draft = undefined;
  });

  it('shows server truth until the leader edits, then keeps the unsaved list', () => {
    render(input());
    expect(draft?.destinations).toBeNull();
    expect(draft?.editorDestinations.map((destination) => destination.id)).toEqual(['a', 'b']);
    act(() => draft?.editDestinations((base) => [...base].reverse()));
    expect(draft?.editorDestinations.map((destination) => destination.id)).toEqual(['b', 'a']);
    expect(draft?.hasUnsavedChanges()).toBe(true);
    render(input({ rawDestinations: [{ ...a, title: 'renamed' }, b] }));
    expect(draft?.destinations?.map((destination) => destination.id)).toEqual(['b', 'a']);
  });

  it('drops a clean editor copy once it matches the server list', () => {
    render(input({ rawDestinations: [b, a] }));
    act(() => { draft?.openEditor(undefined, [a, b]); });
    expect(draft?.destinations).toBeNull();
  });

  it('pins the editor to the scope that holds unsaved edits', () => {
    render(input());
    act(() => draft?.editDestinations((base) => base.slice(1)));
    let opened = true;
    act(() => { opened = draft!.openEditor('sub-1', [sub]); });
    expect(opened).toBe(false);
    expect(draft?.editorScopeId).toBeUndefined();
    act(() => draft?.reset());
    act(() => { opened = draft!.openEditor('sub-1', [sub]); });
    expect(opened).toBe(true);
    expect(draft?.editorScopeId).toBe('sub-1');
    expect(draft?.editorServerDestinations.map((destination) => destination.id)).toEqual(['s']);
  });

  it('returns dirty snapshots that later edits do not change', () => {
    render(input());
    act(() => draft?.markDeleted('a'));
    const snapshot = draft!.dirty();
    act(() => {
      draft?.markDeleted('b');
      draft?.editDaily((base) => base.filter((row) => row.stayDate !== stay.stayDate));
    });
    expect(snapshot).toEqual({ destinations: false, daily: false, trip: false, deletedIds: ['a'] });
    expect(draft?.dirty()).toEqual({ destinations: false, daily: true, trip: false, deletedIds: ['a', 'b'] });
    expect(draft?.dailyAccommodations).toEqual([]);
  });

  it('edits trip details locally and realigns meet times of the draft list', () => {
    const meetAt = new Date('2026-11-01T09:30:00').toISOString();
    render(input({ rawDestinations: [{ ...a, meetAt }, b], serverDestinations: [{ ...a, meetAt }, b] }));
    act(() => draft?.setTripDetails(3, '2026-11-05'));
    expect(draft).toMatchObject({ tripDays: 3, departureDate: '2026-11-05' });
    expect(draft?.dirty()).toMatchObject({ trip: true, destinations: true });
    const aligned = new Date(draft!.destinations![0].meetAt!);
    expect([aligned.getDate(), aligned.getHours(), aligned.getMinutes()]).toEqual([5, 9, 30]);
    render(input({ group: { ...group, tripDays: 3, departureDate: '2026-11-05' } }));
    expect(draft).toMatchObject({ tripDays: 3, departureDate: '2026-11-05' });
  });

  it('rolls a rejected saved write out of unsaved edits, and discards a clean copy', () => {
    const rejected = {
      id: 'op-1', entityType: 'itinerary', status: 'conflict', sequence: 1,
      payload: { _localRollback: { before: [a, b], after: [a, b, stop('added', 2)] } },
    } as unknown as CoreOperation;
    render(input());
    act(() => draft?.editDestinations(() => [a, { ...b, title: 'renamed in draft' }, stop('added', 2)]));
    render(input({ openOperations: [rejected] }));
    expect(draft?.destinations?.map(({ id, title }) => `${id}:${title}`)).toEqual(['a:a', 'b:renamed in draft']);

    act(() => draft?.reset());
    act(() => { draft?.openEditor('sub-1', [sub]); });
    render(input({ openOperations: [rejected, { ...rejected, id: 'op-2' } as CoreOperation] }));
    expect(draft?.destinations).toBeNull();
  });

  it('discards every draft when my itinerary scope changes', () => {
    render(input());
    act(() => {
      draft?.editDestinations((base) => base.slice(1));
      draft?.setTripDetails(4, '2026-12-01');
    });
    render(input({ scopeId: 'sub-1' }));
    expect(draft?.destinations).toBeNull();
    expect(draft?.hasUnsavedChanges()).toBe(false);
    expect(draft).toMatchObject({ editorScopeId: 'sub-1', tripDays: 2, departureDate: '2026-11-01' });
  });
});
