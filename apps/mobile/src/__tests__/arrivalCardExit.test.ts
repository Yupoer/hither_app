import {
  ARRIVAL_CARD_EXIT_MS,
  ARRIVAL_EFFECT_HOLD_MS,
  advanceArrivalCardExit,
  arrivalCardExitPhase,
  beginArrivalCardExit,
  mergeExitingDestinations,
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
});
