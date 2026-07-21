import { canMarkDestinationArrival } from '../utils/arrivalMarking';

describe('canMarkDestinationArrival', () => {
  const stops = [
    { id: 'a', order: 0, subgroupId: null as string | null, closedAt: null as string | null },
    { id: 'b', order: 1, subgroupId: null, closedAt: null },
    { id: 'c', order: 2, subgroupId: null, closedAt: null },
  ];

  it('allows the first stop always', () => {
    expect(
      canMarkDestinationArrival({
        destId: 'a',
        destOrder: 0,
        destSubgroupId: null,
        scopedDestinations: stops,
        myArrivedDestinationIds: new Set(),
      }),
    ).toBe(true);
  });

  it('blocks a later stop until earlier ones are closed or personally arrived', () => {
    expect(
      canMarkDestinationArrival({
        destId: 'b',
        destOrder: 1,
        destSubgroupId: null,
        scopedDestinations: stops,
        myArrivedDestinationIds: new Set(),
      }),
    ).toBe(false);
  });

  it('allows next stop after personal arrival on earlier', () => {
    expect(
      canMarkDestinationArrival({
        destId: 'b',
        destOrder: 1,
        destSubgroupId: null,
        scopedDestinations: stops,
        myArrivedDestinationIds: new Set(['a']),
      }),
    ).toBe(true);
  });

  it('allows next stop when earlier stop is closed by leader', () => {
    const withClosed = [
      { id: 'a', order: 0, subgroupId: null, closedAt: '2026-07-18T00:00:00Z' },
      { id: 'b', order: 1, subgroupId: null, closedAt: null },
    ];
    expect(
      canMarkDestinationArrival({
        destId: 'b',
        destOrder: 1,
        destSubgroupId: null,
        scopedDestinations: withClosed,
        myArrivedDestinationIds: new Set(),
      }),
    ).toBe(true);
  });

  it('scopes by subgroup so main-team earlier stops do not block', () => {
    const mixed = [
      { id: 'main0', order: 0, subgroupId: null, closedAt: null },
      { id: 'sub0', order: 0, subgroupId: 'sg1', closedAt: null },
      { id: 'sub1', order: 1, subgroupId: 'sg1', closedAt: null },
    ];
    expect(
      canMarkDestinationArrival({
        destId: 'sub0',
        destOrder: 0,
        destSubgroupId: 'sg1',
        scopedDestinations: mixed,
        myArrivedDestinationIds: new Set(),
      }),
    ).toBe(true);
  });

  it('allows first visible card when only past-day stops exist earlier (carousel-scoped list)', () => {
    // MapScreen passes filterActiveDestinations only — past days omitted.
    const visibleToday = [
      { id: 'day2-a', order: 5, subgroupId: null as string | null, closedAt: null as string | null },
      { id: 'day2-b', order: 6, subgroupId: null, closedAt: null },
    ];
    expect(
      canMarkDestinationArrival({
        destId: 'day2-a',
        destOrder: 5,
        destSubgroupId: null,
        scopedDestinations: visibleToday,
        myArrivedDestinationIds: new Set(),
      }),
    ).toBe(true);
  });
});
