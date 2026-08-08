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
        },
      ],
    ]);
    const merged = mergeExitingDestinations(open, snapshots, records);
    expect(merged.map((d) => d.id)).toEqual(['a', 'c', 'b']);
  });

  it('drops done cards and does not duplicate open cards', () => {
    const open = [{ id: 'a' }];
    const snapshots = new Map([
      ['a', { id: 'a' }],
      ['b', { id: 'b' }],
    ]);
    const records = new Map([
      ['a', { destinationId: 'a', startedAtMs: 0, phase: 'hold' as const }],
      ['b', { destinationId: 'b', startedAtMs: 0, phase: 'done' as const }],
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
  });
});
