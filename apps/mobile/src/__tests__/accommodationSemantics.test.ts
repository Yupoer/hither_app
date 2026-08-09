import {
  accommodationBoundaryLocks,
  applyPureIndexAnchors,
  dayCollapseStorageKey,
  downgradeAnchorsOnDailyChange,
  dragIndexBoundsForDay,
  isAccommodationDraggable,
  quickAddAccommodationInsertPosition,
  shouldAutoAddAccommodationCards,
  type AccommodationListItem,
} from '../utils/accommodationSemantics';
import { mergeMapMarkers } from '../utils/mapMarkerMerge';
import {
  placeExactMatchKey,
  normalizeCoordinates,
} from '../utils/placeIdentity';
import { eligibleFavoriteDateOptions } from '../utils/favoriteDates';
import { placeTourCard } from '../featureTour/overlayLayout';

describe('shouldAutoAddAccommodationCards', () => {
  it('fires only on none→some with switch on', () => {
    expect(
      shouldAutoAddAccommodationCards({
        previous: 'none',
        next: 'some',
        autoAddEnabled: true,
      }),
    ).toBe(true);
  });

  it('does not fire when switch off', () => {
    expect(
      shouldAutoAddAccommodationCards({
        previous: 'none',
        next: 'some',
        autoAddEnabled: false,
      }),
    ).toBe(false);
  });

  it('does not fire on some→some, some→none, none→none', () => {
    expect(
      shouldAutoAddAccommodationCards({
        previous: 'some',
        next: 'some',
        autoAddEnabled: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoAddAccommodationCards({
        previous: 'some',
        next: 'none',
        autoAddEnabled: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoAddAccommodationCards({
        previous: 'none',
        next: 'none',
        autoAddEnabled: true,
      }),
    ).toBe(false);
  });
});

describe('accommodationBoundaryLocks', () => {
  const day: AccommodationListItem[] = [
    { id: 'a1', kind: 'accommodation', order: 0, day: 1, title: 'Hotel', stayAnchor: true },
    { id: 's1', kind: 'stop', order: 1, day: 1, title: 'Cafe' },
    { id: 'a2', kind: 'accommodation', order: 2, day: 1, title: 'Hotel', stayAnchor: true },
  ];

  it('locks first and last accommodation with active anchors', () => {
    const locks = accommodationBoundaryLocks(day);
    expect(locks.firstLockedId).toBe('a1');
    expect(locks.lastLockedId).toBe('a2');
    expect(locks.lockedIds.has('a1')).toBe(true);
    expect(locks.lockedIds.has('a2')).toBe(true);
    expect(isAccommodationDraggable(day[1], day)).toBe(true);
    expect(isAccommodationDraggable(day[0], day)).toBe(false);
  });

  it('single accommodation is both first and last (one card)', () => {
    const single: AccommodationListItem[] = [
      { id: 'only', kind: 'accommodation', order: 0, day: 1, title: 'Inn', stayAnchor: true },
    ];
    const locks = accommodationBoundaryLocks(single);
    expect(locks.firstLockedId).toBe('only');
    expect(locks.lastLockedId).toBe('only');
    expect(locks.lockedIds.size).toBe(1);
  });

  it('prevents mid accommodation from crossing locks (occupied edge)', () => {
    const withMid: AccommodationListItem[] = [
      { id: 'a1', kind: 'accommodation', order: 0, day: 1, title: 'H', stayAnchor: true },
      { id: 'm', kind: 'accommodation', order: 1, day: 1, title: 'Mid', stayAnchor: false },
      { id: 's1', kind: 'stop', order: 2, day: 1, title: 'S' },
      { id: 'a2', kind: 'accommodation', order: 3, day: 1, title: 'H', stayAnchor: true },
    ];
    const bounds = dragIndexBoundsForDay(withMid, 'm');
    expect(bounds).toEqual({ min: 1, max: 2 });
    // Cannot drag mid onto locked first or last.
    expect(dragIndexBoundsForDay(withMid, 'm')?.min).toBeGreaterThan(0);
    expect(dragIndexBoundsForDay(withMid, 'm')?.max).toBeLessThan(3);
  });

  it('downgrades anchors on some→some / some→none so edges become draggable', () => {
    const downgraded = downgradeAnchorsOnDailyChange(day);
    expect(downgraded.every((i) => i.kind !== 'accommodation' || i.stayAnchor === false)).toBe(
      true,
    );
    const locks = accommodationBoundaryLocks(downgraded);
    expect(locks.lockedIds.size).toBe(0);
    expect(isAccommodationDraggable(downgraded[0], downgraded)).toBe(true);
    expect(isAccommodationDraggable(downgraded[2], downgraded)).toBe(true);
  });

  it('applyPureIndexAnchors re-locks edges after drop', () => {
    const midOnly: AccommodationListItem[] = [
      { id: 'a1', kind: 'accommodation', order: 0, day: 1, title: 'H', stayAnchor: false },
      { id: 's1', kind: 'stop', order: 1, day: 1, title: 'S' },
      { id: 'a2', kind: 'accommodation', order: 2, day: 1, title: 'H', stayAnchor: false },
    ];
    const applied = applyPureIndexAnchors(midOnly);
    expect(applied[0].stayAnchor).toBe(true);
    expect(applied[2].stayAnchor).toBe(true);
    expect(applied[1].stayAnchor).toBe(false);
  });
});

describe('quickAddAccommodationInsertPosition', () => {
  it('inserts before occupied locked tail', () => {
    const existing = [
      { order: 0, day: 1, kind: 'accommodation', stayAnchor: true },
      { order: 1, day: 1, kind: 'stop', stayAnchor: false },
      { order: 2, day: 1, kind: 'accommodation', stayAnchor: true },
    ];
    expect(quickAddAccommodationInsertPosition(existing, 1)).toBe(2);
  });

  it('appends when tail is not a locked accommodation', () => {
    const existing = [
      { order: 0, day: 1, kind: 'stop' },
      { order: 1, day: 1, kind: 'stop' },
    ];
    expect(quickAddAccommodationInsertPosition(existing, 1)).toBe(2);
  });
});

describe('mergeMapMarkers', () => {
  it('always includes daily accommodation and dedupes by identity/coords', () => {
    const markers = mergeMapMarkers({
      dailyAccommodation: {
        id: 'd1',
        title: 'Hotel',
        coordinates: { latitude: 25.033, longitude: 121.565 },
        sourceDestinationId: 'dest-1',
      },
      destinations: [
        {
          id: 'dest-1',
          title: 'Hotel',
          order: 0,
          day: 1,
          coordinates: { latitude: 25.033, longitude: 121.565 },
        },
        {
          id: 'dest-2',
          title: 'Cafe',
          order: 1,
          day: 1,
          coordinates: { latitude: 25.04, longitude: 121.57 },
        },
      ],
    });
    expect(markers).toHaveLength(2);
    expect(markers[0].kind).toBe('daily_accommodation');
    expect(markers[1].id).toBe('dest-2');
  });

  it('dedupes by normalized coordinates when ids differ', () => {
    const markers = mergeMapMarkers({
      dailyAccommodation: {
        id: 'd1',
        title: 'Stay',
        coordinates: { latitude: 25.0330001, longitude: 121.5650001 },
      },
      destinations: [
        {
          id: 'x',
          title: 'Other',
          order: 0,
          day: 1,
          coordinates: { latitude: 25.033, longitude: 121.565 },
        },
      ],
    });
    expect(markers).toHaveLength(1);
    expect(markers[0].kind).toBe('daily_accommodation');
  });
});

describe('placeIdentity', () => {
  it('normalizes and builds exact match keys', () => {
    const a = placeExactMatchKey('  Hotel  A ', {
      latitude: 25.0330004,
      longitude: 121.5650004,
    });
    const b = placeExactMatchKey('Hotel A', {
      latitude: 25.033,
      longitude: 121.565,
    });
    expect(a).toBe(b);
    expect(normalizeCoordinates({ latitude: 1.23456789, longitude: -9.87654321 }))
      .toEqual({ latitude: 1.234568, longitude: -9.876543 });
  });
});

describe('eligibleFavoriteDateOptions', () => {
  it('returns all days before trip', () => {
    const opts = eligibleFavoriteDateOptions({
      departureDate: '2030-01-10',
      tripDays: 3,
      now: new Date('2030-01-01T12:00:00'),
    });
    expect(opts.map((o) => o.day)).toEqual([1, 2, 3]);
  });

  it('returns today and future during trip', () => {
    const opts = eligibleFavoriteDateOptions({
      departureDate: '2030-01-10',
      tripDays: 3,
      now: new Date('2030-01-11T12:00:00'),
    });
    expect(opts.map((o) => o.day)).toEqual([2, 3]);
  });

  it('returns none after trip (cancel/ended path writes nothing)', () => {
    const opts = eligibleFavoriteDateOptions({
      departureDate: '2030-01-10',
      tripDays: 3,
      now: new Date('2030-01-20T12:00:00'),
    });
    // No eligible day ⇒ UI cannot confirm a write.
    expect(opts).toEqual([]);
    expect(opts.length).toBe(0);
  });
});

describe('dayCollapseStorageKey', () => {
  it('scopes by account, group, date', () => {
    expect(dayCollapseStorageKey('u1', 'g1', '2026-08-10')).toBe(
      'hither.dayCollapse.v1:u1:g1:2026-08-10',
    );
  });
});

describe('placeTourCard final centering (#162)', () => {
  it('centers final card in usable viewport (not 0.35 hardcode only)', () => {
    const result = placeTourCard({
      hole: null,
      windowWidth: 390,
      windowHeight: 844,
      insets: { top: 47, bottom: 34 },
      cardHeight: 160,
    });
    const topSafe = 47 + 12;
    const bottomSafe = 844 - 34 - 12;
    const usable = bottomSafe - topSafe;
    // Center of usable viewport, clamped.
    const expectedCenter = topSafe + (usable - 160) / 2;
    expect(result.cardTop).toBeCloseTo(expectedCenter, 0);
    expect(result.cardTop).not.toBeCloseTo(844 * 0.35, 0);
  });
});
