import {
  accommodationBoundaryLocks,
  applyPureIndexAnchors,
  crossDayGapCorrection,
  dayBlockRange,
  dayCollapseStorageKey,
  DEFAULT_REORDER_LAYOUT,
  downgradeAnchorsOnDailyChange,
  dragIndexBoundsForDay,
  dragTargetIndexFromOffset,
  isAccommodationDraggable,
  legalDragIndicesForList,
  moveDayBlockBefore,
  orderAfterDragMove,
  proposedOrderPreservesBoundaryLocks,
  quickAddAccommodationInsertPosition,
  renumberReorderListDays,
  shouldAutoAddAccommodationCards,
  snapToLegalDragIndex,
  type AccommodationListItem,
  type ReorderListEntry,
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

  it('applyPureIndexAnchors clears anchors so stay cards stay draggable', () => {
    const midOnly: AccommodationListItem[] = [
      { id: 'a1', kind: 'accommodation', order: 0, day: 1, title: 'H', stayAnchor: false },
      { id: 's1', kind: 'stop', order: 1, day: 1, title: 'S' },
      { id: 'a2', kind: 'accommodation', order: 2, day: 1, title: 'H', stayAnchor: false },
    ];
    const applied = applyPureIndexAnchors(midOnly);
    expect(applied[0].stayAnchor).toBe(false);
    expect(applied[2].stayAnchor).toBe(false);
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

describe('legalDragIndicesForList (cross-day)', () => {
  const dest = (
    id: string,
    day: number,
    kind: 'stop' | 'accommodation' = 'stop',
    stayAnchor?: boolean,
  ): ReorderListEntry => ({
    type: 'dest',
    id,
    day,
    kind,
    stayAnchor,
    title: id,
  });
  const header = (day: number): ReorderListEntry => ({
    type: 'header',
    day,
    id: `header-${day}`,
  });

  it('allows a mid stop to move to another day mid slot', () => {
    // Day1: hotel, A, hotel | Day2: hotel, B, hotel | Day3: hotel, C, hotel | Day4: hotel, D, hotel
    const order: ReorderListEntry[] = [
      header(1), dest('h1a', 1, 'accommodation', true), dest('A', 1), dest('h1b', 1, 'accommodation', true),
      header(2), dest('h2a', 2, 'accommodation', true), dest('B', 2), dest('h2b', 2, 'accommodation', true),
      header(3), dest('h3a', 3, 'accommodation', true), dest('C', 3), dest('h3b', 3, 'accommodation', true),
      header(4), dest('h4a', 4, 'accommodation', true), dest('D', 4), dest('h4b', 4, 'accommodation', true),
    ];
    const legal = legalDragIndicesForList(order, 'B');
    const indexOf = (id: string) => order.findIndex((e) => e.type === 'dest' && e.id === id);
    // Can stay on B or land on other mid stops (A/C/D) by swapping into their slots.
    expect(legal).toContain(indexOf('B'));
    expect(legal).toContain(indexOf('A'));
    expect(legal).toContain(indexOf('C'));
    expect(legal).toContain(indexOf('D'));
    // Cannot land on locked head/tail hotels.
    expect(legal).not.toContain(indexOf('h1a'));
    expect(legal).not.toContain(indexOf('h4b'));
  });

  it('allows a mid stop to drop into an empty day block', () => {
    // Day1 has stop A; Day2 and Day3 are empty headers only.
    const order: ReorderListEntry[] = [
      header(1),
      dest('A', 1),
      header(2),
      header(3),
    ];
    const legal = legalDragIndicesForList(order, 'A');
    const h2 = order.findIndex((e) => e.type === 'header' && e.day === 2);
    const h3 = order.findIndex((e) => e.type === 'header' && e.day === 3);
    // Empty-day header indices must be legal so drag can enter that block.
    expect(legal).toContain(h2);
    expect(legal).toContain(h3);
    // After drop into day 2 header slot, A sits under day 2.
    const intoDay2 = orderAfterDragMove(order, 1, h2);
    let day = 1;
    let assigned = 0;
    for (const e of intoDay2) {
      if (e.type === 'header') day = e.day;
      else if (e.type === 'dest' && e.id === 'A') assigned = day;
    }
    expect(assigned).toBe(2);
  });

  it('freezes Day1 header; Day2+ may land mid-dest within neighbor span only', () => {
    const order: ReorderListEntry[] = [
      header(1),
      dest('A', 1),
      dest('B', 1),
      header(2),
      dest('C', 2),
      header(3),
      dest('D', 3),
    ];
    const h1 = order.findIndex((e) => e.id === 'header-1');
    const h2 = order.findIndex((e) => e.id === 'header-2');
    const h3 = order.findIndex((e) => e.id === 'header-3');
    const idxA = order.findIndex((e) => e.id === 'A');
    const idxB = order.findIndex((e) => e.id === 'B');
    const idxD = order.findIndex((e) => e.id === 'D');
    expect(legalDragIndicesForList(order, 'header-1')).toEqual([h1]);

    // Day2: after H1 through H3 (inclusive) — mid-dest of Day1 allowed.
    const legalMid = legalDragIndicesForList(order, 'header-2');
    expect(legalMid).toContain(idxA);
    expect(legalMid).toContain(idxB);
    expect(legalMid).toContain(h2);
    expect(legalMid).toContain(h3);
    // Cannot go before Day1 or after Day3 header.
    expect(legalMid).not.toContain(h1);
    expect(legalMid).not.toContain(idxD);
    expect(legalMid).not.toContain(order.length);

    // Day3 (last): after H2 through end — not into Day1 stops.
    const legalLast = legalDragIndicesForList(order, 'header-3');
    expect(legalLast).toContain(h3);
    expect(legalLast).toContain(order.length);
    expect(legalLast).toContain(order.findIndex((e) => e.id === 'C'));
    expect(legalLast).not.toContain(idxA);
    expect(legalLast).not.toContain(h1);
  });

  it('moveDayBlockBefore into Day1 mid-dest reassigns trailing stops to Day2', () => {
    const order: ReorderListEntry[] = [
      header(1), dest('A', 1), dest('B', 1), dest('C', 1),
      header(2), dest('D', 2), dest('E', 2),
      header(3), dest('F', 3),
    ];
    const h2 = order.findIndex((e) => e.id === 'header-2');
    const idxB = order.findIndex((e) => e.id === 'B');
    // Drop Day2 block before B (between A and B).
    const moved = moveDayBlockBefore(order, h2, idxB);
    const renumbered = renumberReorderListDays(moved);
    const ids = renumbered.filter((e) => e.type === 'dest').map((e) => e.id);
    expect(ids).toEqual(['A', 'D', 'E', 'B', 'C', 'F']);
    const dayOf = (id: string) => {
      const e = renumbered.find((x) => x.type === 'dest' && x.id === id);
      return e && e.type === 'dest' ? e.day : -1;
    };
    expect(dayOf('A')).toBe(1);
    // Between Day2 header and Day3: D,E + former Day1 trailing B,C.
    expect(dayOf('D')).toBe(2);
    expect(dayOf('E')).toBe(2);
    expect(dayOf('B')).toBe(2);
    expect(dayOf('C')).toBe(2);
    expect(dayOf('F')).toBe(3);
  });

  it('moveDayBlockBefore moves whole day (header+dests) and keeps all ids', () => {
    const order: ReorderListEntry[] = [
      header(1), dest('A', 1), dest('B', 1),
      header(2), dest('C', 2), dest('D', 2),
      header(3), dest('E', 3),
    ];
    const h2 = order.findIndex((e) => e.id === 'header-2');
    const h3 = order.findIndex((e) => e.id === 'header-3');
    // Move day2 before day3 is no structural change of relative order among 2/3;
    // move day3 before day2:
    const moved = moveDayBlockBefore(order, h3, h2);
    const renumbered = renumberReorderListDays(moved);
    const ids = renumbered.filter((e) => e.type === 'dest').map((e) => e.id);
    expect(ids).toEqual(['A', 'B', 'E', 'C', 'D']);
    expect(ids).toHaveLength(5);
    // Day assignment after renumber.
    const dayOf = (id: string) => {
      const e = renumbered.find((x) => x.type === 'dest' && x.id === id);
      return e && e.type === 'dest' ? e.day : -1;
    };
    expect(dayOf('A')).toBe(1);
    expect(dayOf('B')).toBe(1);
    expect(dayOf('E')).toBe(2);
    expect(dayOf('C')).toBe(3);
    expect(dayOf('D')).toBe(3);
  });

  it('moveDayBlockBefore cannot pull a block above Day1 header', () => {
    const order: ReorderListEntry[] = [
      header(1), dest('A', 1),
      header(2), dest('B', 2),
    ];
    const h2 = order.findIndex((e) => e.id === 'header-2');
    const h1 = order.findIndex((e) => e.id === 'header-1');
    const moved = moveDayBlockBefore(order, h2, h1);
    const renumbered = renumberReorderListDays(moved);
    // Day1 header stays first; clamp inserts right after H1 (may empty Day1).
    expect(renumbered[0]).toMatchObject({ type: 'header', day: 1 });
    expect(renumbered.filter((e) => e.type === 'header').map((e) => e.type === 'header' && e.day)).toEqual([1, 2]);
    const ids = renumbered.filter((e) => e.type === 'dest').map((e) => e.id);
    expect(ids).toEqual(['B', 'A']);
    const dayOf = (id: string) => {
      const e = renumbered.find((x) => x.type === 'dest' && x.id === id);
      return e && e.type === 'dest' ? e.day : -1;
    };
    expect(dayOf('B')).toBe(2);
    expect(dayOf('A')).toBe(2);
  });

  it('freezes locked boundary accommodations', () => {
    const order: ReorderListEntry[] = [
      header(1),
      dest('h1', 1, 'accommodation', true),
      dest('s1', 1),
      dest('h2', 1, 'accommodation', true),
    ];
    const headIdx = order.findIndex((e) => e.type === 'dest' && e.id === 'h1');
    expect(legalDragIndicesForList(order, 'h1')).toEqual([headIdx]);
    expect(legalDragIndicesForList(order, 'h2')).toEqual([
      order.findIndex((e) => e.type === 'dest' && e.id === 'h2'),
    ]);
  });

  it('rejects proposed orders that push stay anchors off the edge', () => {
    const base: ReorderListEntry[] = [
      header(1),
      dest('h1', 1, 'accommodation', true),
      dest('s1', 1),
      dest('h2', 1, 'accommodation', true),
    ];
    const bad = orderAfterDragMove(base, 2, 1); // move s1 before h1
    expect(proposedOrderPreservesBoundaryLocks(bad, 's1')).toBe(false);
    const good = orderAfterDragMove(base, 2, 2); // no-op mid
    expect(proposedOrderPreservesBoundaryLocks(good, 's1')).toBe(true);
  });

  it('snapToLegalDragIndex picks nearest legal slot', () => {
    expect(snapToLegalDragIndex([1, 5, 9], 6)).toBe(5);
    expect(snapToLegalDragIndex([1, 5, 9], 0)).toBe(1);
  });

  it('snapToLegalDragIndex breaks ties in drag direction (cross-day)', () => {
    // Sparse legal mid-day with locked hotels: mid=2, empty day=4.
    expect(snapToLegalDragIndex([2, 4], 3, 1)).toBe(4);
    expect(snapToLegalDragIndex([2, 4], 3, -1)).toBe(2);
    // No direction keeps first best (lower index).
    expect(snapToLegalDragIndex([2, 4], 3, 0)).toBe(2);
  });

  it('crossDayGapCorrection counts headers between start and aim', () => {
    const order: ReorderListEntry[] = [
      header(1),
      dest('A', 1),
      header(2),
      header(3),
    ];
    // Dragging down from A (1) toward day3 (aim ~3): crosses H2 and H3 → +2.
    expect(crossDayGapCorrection(order, 1, 3, 1)).toBe(2);
    // Dragging up from end toward start: negative.
    expect(crossDayGapCorrection(order, 3, 1, 1)).toBe(-2);
  });

  it('dragTargetIndexFromOffset reaches empty day with modest dy (geometry)', () => {
    const order: ReorderListEntry[] = [
      header(1),
      dest('A', 1),
      header(2),
      header(3),
    ];
    // Past mid of A (+ day gap) should aim at day2 header index 2.
    const toDay2 = dragTargetIndexFromOffset(order, 1, 52, DEFAULT_REORDER_LAYOUT);
    expect(toDay2).toBeGreaterThanOrEqual(2);
    const legal = legalDragIndicesForList(order, 'A');
    const snapped = snapToLegalDragIndex(legal, toDay2, 1);
    const proposed = orderAfterDragMove(order, 1, snapped);
    let day = 1;
    let assigned = 0;
    for (const e of proposed) {
      if (e.type === 'header') day = e.day;
      else if (e.type === 'dest' && e.id === 'A') assigned = day;
    }
    expect(assigned).toBeGreaterThanOrEqual(2);
  });

  it('dragTargetIndexFromOffset moves mid stop across locked-hotel day into next day', () => {
    const order: ReorderListEntry[] = [
      header(1),
      dest('h1', 1, 'accommodation', true),
      dest('S', 1),
      dest('h2', 1, 'accommodation', true),
      header(2),
    ];
    const start = order.findIndex((e) => e.type === 'dest' && e.id === 'S');
    // Large enough dy to clear day1 tail + gap into day2 header.
    const raw = dragTargetIndexFromOffset(order, start, 156, DEFAULT_REORDER_LAYOUT);
    const legal = legalDragIndicesForList(order, 'S');
    const target = snapToLegalDragIndex(legal, raw, 1);
    const proposed = orderAfterDragMove(order, start, target);
    let day = 1;
    let assigned = 0;
    for (const e of proposed) {
      if (e.type === 'header') day = e.day;
      else if (e.type === 'dest' && e.id === 'S') assigned = day;
    }
    expect(assigned).toBe(2);
  });
});

describe('DEFAULT_REORDER_LAYOUT scale', () => {
  it('is 1.3× the previous 72/60/56 defaults', () => {
    expect(DEFAULT_REORDER_LAYOUT).toEqual({
      headerHeight: 72 * 1.3,
      rowHeight: 60 * 1.3,
      dayGapHeight: 56 * 1.3,
    });
  });
});

describe('mergeMapMarkers', () => {
  it('keeps the gathering stop when daily stay is set from that stop', () => {
    const markers = mergeMapMarkers({
      dailyAccommodation: {
        id: 'd1',
        title: 'Hotel',
        coordinates: { latitude: 25.033, longitude: 121.565 },
        sourceDestinationId: 'dest-1',
        day: 1,
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
    // Stop pin stays; daily bed does not hide/replace the gathering point.
    expect(markers.some((m) => m.id === 'dest-1')).toBe(true);
    expect(markers.some((m) => m.id === 'dest-2')).toBe(true);
    expect(markers.some((m) => m.kind === 'daily_accommodation')).toBe(false);
  });

  it('does not replace a gathering stop with a daily bed at same coords', () => {
    const markers = mergeMapMarkers({
      dailyAccommodation: {
        id: 'd1',
        title: 'Stay',
        coordinates: { latitude: 25.0330001, longitude: 121.5650001 },
        day: 1,
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
    expect(markers[0].id).toBe('x');
    expect(markers[0].kind).toBe('destination');
  });

  it('shows daily beds per day when only accommodation cards exist', () => {
    const coords = { latitude: 25.033, longitude: 121.565 };
    const markers = mergeMapMarkers({
      dailyAccommodations: [
        { id: 'd1', title: 'Hotel', coordinates: coords, day: 1 },
        { id: 'd2', title: 'Hotel', coordinates: coords, day: 2 },
      ],
      destinations: [
        {
          id: 's1',
          title: 'Hotel',
          order: 0,
          day: 1,
          kind: 'accommodation' as const,
          coordinates: coords,
        },
        {
          id: 's2',
          title: 'Hotel',
          order: 1,
          day: 2,
          kind: 'accommodation' as const,
          coordinates: coords,
        },
      ],
    });
    // Accommodation cards claim slots first (bed emoji); daily upgrades optional.
    expect(markers).toHaveLength(2);
    expect(markers.every((m) => m.day === 1 || m.day === 2)).toBe(true);
    expect(
      markers.every(
        (m) => m.kind === 'daily_accommodation' || m.emoji === '🛏️',
      ),
    ).toBe(true);
  });

  it('keeps a gathering stop over an accommodation card at the same coords', () => {
    const coords = { latitude: 25.1, longitude: 121.5 };
    const markers = mergeMapMarkers({
      destinations: [
        {
          id: 'stop',
          title: 'Hotel lobby',
          order: 0,
          day: 1,
          coordinates: coords,
        },
        {
          id: 'acc',
          title: 'Hotel',
          order: 1,
          day: 1,
          kind: 'accommodation' as const,
          coordinates: coords,
        },
      ],
    });
    // Gathering stop wins so setting stay never erases the stop pin.
    expect(markers).toHaveLength(1);
    expect(markers[0].id).toBe('stop');
    expect(markers[0].kind).toBe('destination');
  });

  it('shows a daily bed when no destination claims the day+coords slot', () => {
    const markers = mergeMapMarkers({
      dailyAccommodation: {
        id: 'd1',
        title: 'Hotel only',
        coordinates: { latitude: 25.2, longitude: 121.6 },
        day: 1,
      },
      destinations: [
        {
          id: 'cafe',
          title: 'Cafe',
          order: 0,
          day: 1,
          coordinates: { latitude: 25.3, longitude: 121.7 },
        },
      ],
    });
    expect(markers).toHaveLength(2);
    expect(markers.some((m) => m.kind === 'daily_accommodation')).toBe(true);
    expect(markers.some((m) => m.id === 'cafe')).toBe(true);
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
