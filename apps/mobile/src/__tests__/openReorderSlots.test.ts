import {
  mapOpenReorderToPersistedPositions,
  openPositionSlotsFromOpenDestinations,
} from '../utils/openReorderSlots';

describe('openReorderSlots (#151 Sol r2 exit-hold)', () => {
  it('derives slots only from open destinations (ignores exit-hold closed rows)', () => {
    // Carousel during exit hold: closed@0 still visible, opens at 1,2.
    const carouselIncludingExit = [
      { id: 'closed', order: 0 },
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
    ];
    const openOnly = [
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
    ];

    // Bug pattern: mapping through carousel slots collides with closed@0.
    const buggySlots = openPositionSlotsFromOpenDestinations(carouselIncludingExit);
    expect(buggySlots).toEqual([0, 1, 2]);

    const openSlots = openPositionSlotsFromOpenDestinations(openOnly);
    expect(openSlots).toEqual([1, 2]);

    // Editor zero-based reorder: swap a and b → relative [b@0, a@1].
    const editorUpdates = [
      { id: 'b', position: 0, day: 1 },
      { id: 'a', position: 1, day: 1 },
    ];

    const buggyPersisted = mapOpenReorderToPersistedPositions(editorUpdates, buggySlots);
    expect(buggyPersisted.map((u) => u.position)).toEqual([0, 1]); // collides closed@0

    const fixed = mapOpenReorderToPersistedPositions(editorUpdates, openSlots);
    expect(fixed).toEqual([
      { id: 'b', position: 1, day: 1 },
      { id: 'a', position: 2, day: 1 },
    ]);
  });

  it('preserves middle closed slots when open stops reorder around them', () => {
    // open@0, closed@1 (exiting), open@2 — editor only sees opens.
    const openOnly = [
      { id: 'a', order: 0 },
      { id: 'c', order: 2 },
    ];
    const slots = openPositionSlotsFromOpenDestinations(openOnly);
    expect(slots).toEqual([0, 2]);

    const swapped = mapOpenReorderToPersistedPositions(
      [
        { id: 'c', position: 0, day: 1 },
        { id: 'a', position: 1, day: 1 },
      ],
      slots,
    );
    expect(swapped.map((u) => ({ id: u.id, position: u.position }))).toEqual([
      { id: 'c', position: 0 },
      { id: 'a', position: 2 },
    ]);
  });

  it('is stable whether or not exit animation has finished (same open snapshot)', () => {
    const open = [
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
    ];
    const updates = [
      { id: 'b', position: 0, day: 1 },
      { id: 'a', position: 1, day: 1 },
    ];
    const duringHold = mapOpenReorderToPersistedPositions(
      updates,
      openPositionSlotsFromOpenDestinations(open),
    );
    const afterExit = mapOpenReorderToPersistedPositions(
      updates,
      openPositionSlotsFromOpenDestinations(open),
    );
    expect(duringHold).toEqual(afterExit);
    expect(duringHold.map((u) => u.position)).toEqual([1, 2]);
  });
});
