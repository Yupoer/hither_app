import {
  ARRIVAL_CARD_EXIT_MS,
  ARRIVAL_EFFECT_HOLD_MS,
  PERSONAL_ARRIVAL_CELEBRATE_MS,
  advanceArrivalCardExit,
  armCelebrateClearTimer,
  arrivalCardExitPhase,
  beginArrivalCardExit,
  cancelCelebrateClearTimer,
  mergeExitingDestinations,
  nextVisibleCarouselOrder,
  resolveExitIndexAtStart,
  type ArrivalCardExitRecord,
  type CelebrateClearStore,
} from '../utils/arrivalCardExit';

describe('arrivalCardExit (#149)', () => {
  it('holds arrival effect for 3.2s then exits for 440ms', () => {
    expect(ARRIVAL_EFFECT_HOLD_MS).toBe(3200);
    expect(ARRIVAL_CARD_EXIT_MS).toBe(440);
    expect(arrivalCardExitPhase(0)).toBe('hold');
    expect(arrivalCardExitPhase(3199)).toBe('hold');
    expect(arrivalCardExitPhase(3200)).toBe('exit');
    expect(arrivalCardExitPhase(3200 + 439)).toBe('exit');
    expect(arrivalCardExitPhase(3200 + 440)).toBe('done');
  });

  it('is idempotent — second begin returns null', () => {
    const first = beginArrivalCardExit(new Map(), 'd1', 1000);
    expect(first).not.toBeNull();
    const map = new Map([['d1', first!]]);
    expect(beginArrivalCardExit(map, 'd1', 2000)).toBeNull();
  });

  it('advances hold → exit → done from elapsed time', () => {
    const start = beginArrivalCardExit(new Map(), 'd1', 0)!;
    expect(advanceArrivalCardExit(start, 1000).phase).toBe('hold');
    expect(advanceArrivalCardExit(start, 3200).phase).toBe('exit');
    expect(advanceArrivalCardExit(start, 3640).phase).toBe('done');
  });

  it('keeps exiting cards in the list after open filter drops them', () => {
    const open = [{ id: 'a' }, { id: 'c' }];
    const snapshots = new Map([['b', { id: 'b' }]]);
    const records = new Map([
      [
        'b',
        {
          destinationId: 'b',
          startedAtMs: 0,
          phase: 'exit' as const,
          indexAtStart: 1,
        },
      ],
    ]);
    const merged = mergeExitingDestinations(open, snapshots, records);
    // Original index preserved — not appended to the end.
    expect(merged.map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('preserves middle-card order through hold → exit → done (#149 Sol)', () => {
    const snapshots = new Map([
      ['a', { id: 'a' }],
      ['b', { id: 'b' }],
      ['c', { id: 'c' }],
    ]);
    // [A,B,C] then B closes → open is [A,C]; B must stay at index 1.
    const hold = beginArrivalCardExit(new Map(), 'b', 0, 1)!;
    expect(hold.indexAtStart).toBe(1);
    const holdRecords = new Map([['b', hold]]);
    const holdMerged = mergeExitingDestinations(
      [{ id: 'a' }, { id: 'c' }],
      snapshots,
      holdRecords,
    );
    expect(holdMerged.map((d) => d.id)).toEqual(['a', 'b', 'c']);

    const exit = advanceArrivalCardExit(hold, ARRIVAL_EFFECT_HOLD_MS);
    expect(exit.phase).toBe('exit');
    const exitMerged = mergeExitingDestinations(
      [{ id: 'a' }, { id: 'c' }],
      snapshots,
      new Map([['b', exit]]),
    );
    expect(exitMerged.map((d) => d.id)).toEqual(['a', 'b', 'c']);

    const done = advanceArrivalCardExit(hold, ARRIVAL_EFFECT_HOLD_MS + ARRIVAL_CARD_EXIT_MS);
    expect(done.phase).toBe('done');
    const doneMerged = mergeExitingDestinations(
      [{ id: 'a' }, { id: 'c' }],
      snapshots,
      new Map([['b', done]]),
    );
    expect(doneMerged.map((d) => d.id)).toEqual(['a', 'c']);
  });

  it('drops done cards and does not duplicate open cards', () => {
    const open = [{ id: 'a' }];
    const snapshots = new Map([
      ['a', { id: 'a' }],
      ['b', { id: 'b' }],
    ]);
    const records = new Map([
      [
        'a',
        {
          destinationId: 'a',
          startedAtMs: 0,
          phase: 'hold' as const,
          indexAtStart: 0,
        },
      ],
      [
        'b',
        {
          destinationId: 'b',
          startedAtMs: 0,
          phase: 'done' as const,
          indexAtStart: 1,
        },
      ],
    ]);
    const merged = mergeExitingDestinations(open, snapshots, records);
    expect(merged.map((d) => d.id)).toEqual(['a']);
  });

  it('completion hold cancels personal 1.6s clear so effect lasts 3.2s (#149 Sol)', () => {
    jest.useFakeTimers();
    const store: CelebrateClearStore = new Map();
    let celebrateId: string | null = null;

    // Personal arrival flash.
    celebrateId = 'd1';
    armCelebrateClearTimer(
      store,
      'd1',
      PERSONAL_ARRIVAL_CELEBRATE_MS,
      () => {
        if (celebrateId === 'd1') celebrateId = null;
      },
    );

    // Stop completes promptly → start 3.2s hold (must cancel 1.6s timer).
    cancelCelebrateClearTimer(store, 'd1');
    celebrateId = 'd1';
    armCelebrateClearTimer(
      store,
      'd1',
      ARRIVAL_EFFECT_HOLD_MS,
      () => {
        if (celebrateId === 'd1') celebrateId = null;
      },
    );

    jest.advanceTimersByTime(PERSONAL_ARRIVAL_CELEBRATE_MS);
    expect(celebrateId).toBe('d1'); // still holding past 1.6s

    jest.advanceTimersByTime(ARRIVAL_EFFECT_HOLD_MS - PERSONAL_ARRIVAL_CELEBRATE_MS - 1);
    expect(celebrateId).toBe('d1');

    jest.advanceTimersByTime(1);
    expect(celebrateId).toBeNull();

    jest.useRealTimers();
  });

  it('MapScreen owns celebrate clear via armCelebrateClearTimer', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const map = fs.readFileSync(
      path.join(__dirname, '../screens/MapScreen.tsx'),
      'utf8',
    );
    expect(map).toContain('armCelebrateClearTimer');
    expect(map).toContain('cancelCelebrateClearTimer');
    expect(map).toContain('PERSONAL_ARRIVAL_CELEBRATE_MS');
    expect(map).toContain('ARRIVAL_EFFECT_HOLD_MS');
    // No orphan untracked 1600 clear that can race the hold.
    expect(map).not.toMatch(/setTimeout\(\(\) => \{\s*setArrivalCelebrateDestId[\s\S]*?\}, 1_600\)/);
    // Overlapping exits must rank from full visible order, not open-only.
    expect(map).toContain('nextVisibleCarouselOrder');
    expect(map).toContain('resolveExitIndexAtStart');
    expect(map).toContain('prevVisibleDestOrderRef');
  });

  it('rebases a surviving exit after an earlier card is done (#149 Sol r4)', () => {
    // Reproduce: [A,B,C,D] → close B → close C while B still holds. After B
    // finishes, C must stay before D instead of using its stale index 2.
    let visibleOrder = ['a', 'b', 'c', 'd'];
    let open = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const records = new Map<string, ArrivalCardExitRecord>();
    const snapshots = new Map([
      ['a', { id: 'a' }],
      ['b', { id: 'b' }],
      ['c', { id: 'c' }],
      ['d', { id: 'd' }],
    ]);

    // Close B.
    const bIdx = resolveExitIndexAtStart(visibleOrder, 'b', visibleOrder.length);
    const bHold = beginArrivalCardExit(records, 'b', 0, bIdx)!;
    records.set('b', bHold);
    open = [{ id: 'a' }, { id: 'c' }, { id: 'd' }];
    visibleOrder = nextVisibleCarouselOrder(
      visibleOrder,
      open.map((d) => d.id),
      [...records.keys()],
    );
    expect(bIdx).toBe(1);
    expect(visibleOrder).toEqual(['a', 'b', 'c', 'd']);
    expect(
      mergeExitingDestinations(open, snapshots, records, visibleOrder).map((d) => d.id),
    ).toEqual(['a', 'b', 'c', 'd']);

    // Close C while B is still in the 3.2s hold (open-only would give C index 1).
    const cIdx = resolveExitIndexAtStart(visibleOrder, 'c', visibleOrder.length);
    const cHold = beginArrivalCardExit(records, 'c', 100, cIdx)!;
    records.set('c', cHold);
    open = [{ id: 'a' }, { id: 'd' }];
    visibleOrder = nextVisibleCarouselOrder(
      visibleOrder,
      open.map((d) => d.id),
      [...records.keys()],
    );
    expect(cIdx).toBe(2);
    expect(visibleOrder).toEqual(['a', 'b', 'c', 'd']);
    expect(
      mergeExitingDestinations(open, snapshots, records, visibleOrder).map((d) => d.id),
    ).toEqual(['a', 'b', 'c', 'd']);

    // Advance B through exit while C still holding — order stays A,B,C,D.
    const bExit = advanceArrivalCardExit(bHold, ARRIVAL_EFFECT_HOLD_MS);
    records.set('b', bExit);
    expect(bExit.phase).toBe('exit');
    expect(
      mergeExitingDestinations(open, snapshots, records, visibleOrder).map((d) => d.id),
    ).toEqual(['a', 'b', 'c', 'd']);

    // B done → removed from records; C remains active before D → [A,C,D].
    const bDone = advanceArrivalCardExit(
      bExit,
      ARRIVAL_EFFECT_HOLD_MS + ARRIVAL_CARD_EXIT_MS,
    );
    expect(bDone.phase).toBe('done');
    records.delete('b');
    visibleOrder = nextVisibleCarouselOrder(
      visibleOrder,
      open.map((d) => d.id),
      [...records.keys()],
    );
    expect(visibleOrder).toEqual(['a', 'c', 'd']);
    expect(
      mergeExitingDestinations(open, snapshots, records, visibleOrder).map((d) => d.id),
    ).toEqual(['a', 'c', 'd']);
  });

  it('follows open day/order when nothing is exiting (reorder must not freeze)', () => {
    // Stale previous order after itinerary edit: day4 cards first, day2 later.
    const previousOrder = ['d4a', 'd4b', 'd2a', 'd4c'];
    const openSorted = [
      { id: 'd2a' },
      { id: 'd4a' },
      { id: 'd4b' },
      { id: 'd4c' },
    ];
    const next = nextVisibleCarouselOrder(
      previousOrder,
      openSorted.map((d) => d.id),
      [],
    );
    expect(next).toEqual(['d2a', 'd4a', 'd4b', 'd4c']);
    expect(
      mergeExitingDestinations(
        openSorted,
        new Map(),
        new Map(),
        previousOrder,
      ).map((d) => d.id),
    ).toEqual(['d2a', 'd4a', 'd4b', 'd4c']);
  });
});
