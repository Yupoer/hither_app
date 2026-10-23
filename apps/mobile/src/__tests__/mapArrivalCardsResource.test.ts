import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Destination } from '../types';
import { MapArrivalCardsResource, type MapArrivalCardsInput } from '../screens/MapScreen/MapArrivalCardsResource';
import { armCelebrateClearTimer } from '../utils/arrivalCardExit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function destination(id: string, closedAt?: string): Destination {
  return { id, title: id, order: id === 'a' ? 0 : 1, day: 1, coordinates: { latitude: 25, longitude: 121 }, closedAt };
}
function cardInput(): MapArrivalCardsInput {
  const open = [destination('a'), destination('b')];
  return { allScopedDestinations: open, arrivalExitContextRef: { current: 'context' }, arrivalExitContext: 'context',
    arrivalExitTimersRef: { current: new Map() }, celebrateClearTimersRef: { current: new Map() },
    setArrivalExitRecords: jest.fn(), setArrivalExitSnapshots: jest.fn(), setArrivalCelebrateDestId: jest.fn(),
    knownClosedDestIdsRef: { current: null }, remoteAutoCompleteDestIdsRef: { current: new Set() },
    state: { group: { id: 'group' } }, groupId: 'group', loading: false, prevVisibleDestOrderRef: { current: [] },
    uiVisible: true, openDestinations: open, startArrivalCardExit: jest.fn(), arrivalExitRecords: new Map() };
}

function addTimers(input: MapArrivalCardsInput, onFire = jest.fn()) {
  const exit: Parameters<typeof armCelebrateClearTimer>[0] = new Map();
  armCelebrateClearTimer(exit, 'a', 100, onFire);
  const timer = exit.get('a');
  if (timer === undefined) throw new Error('Exit timer must be installed');
  input.arrivalExitTimersRef.current.set('a', [timer]);
  armCelebrateClearTimer(input.celebrateClearTimersRef.current, 'a', 100, onFire);
}

describe('Map completed card resource', () => {
  let tree: ReactTestRenderer | undefined;
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.useRealTimers(); });

  it('seeds historical closures and starts exactly one exit at its previous full carousel rank', () => {
    const input = cardInput();
    input.allScopedDestinations = [destination('past', 'old'), ...input.allScopedDestinations];
    act(() => { tree = create(React.createElement(MapArrivalCardsResource, input)); });
    expect(input.startArrivalCardExit).not.toHaveBeenCalled();
    const closedA = destination('a', 'new');
    const next = { ...input, allScopedDestinations: [destination('past', 'old'), closedA, destination('b')],
      openDestinations: [destination('b')] };
    act(() => tree?.update(React.createElement(MapArrivalCardsResource, next)));
    expect(input.startArrivalCardExit).toHaveBeenCalledTimes(1);
    expect(input.startArrivalCardExit).toHaveBeenCalledWith(closedA, 0);
    expect(input.prevVisibleDestOrderRef.current).toEqual(['a', 'b']);
    act(() => tree?.update(React.createElement(MapArrivalCardsResource, { ...next, allScopedDestinations: [...next.allScopedDestinations] })));
    expect(input.startArrivalCardExit).toHaveBeenCalledTimes(1);
  });

  it('cancels foreground exit and celebrate timers before hidden observation and never replays hidden completions', () => {
    const input = cardInput();
    const timerFired = jest.fn();
    act(() => { tree = create(React.createElement(MapArrivalCardsResource, input)); });
    addTimers(input, timerFired);
    const hidden = { ...input, uiVisible: false,
      allScopedDestinations: [destination('a', 'background'), destination('b')], openDestinations: [destination('b')] };
    act(() => tree?.update(React.createElement(MapArrivalCardsResource, hidden)));
    expect(input.arrivalExitTimersRef.current.size).toBe(0);
    expect(input.celebrateClearTimersRef.current.size).toBe(0);
    expect(input.setArrivalCelebrateDestId).toHaveBeenCalledWith(null);
    act(() => { jest.advanceTimersByTime(200); });
    expect(timerFired).not.toHaveBeenCalled();
    act(() => tree?.update(React.createElement(MapArrivalCardsResource, { ...hidden, uiVisible: true })));
    expect(input.startArrivalCardExit).not.toHaveBeenCalled();
  });

  it('clears only the stable card owner resources on context replacement and final unmount', () => {
    const input = cardInput();
    act(() => { tree = create(React.createElement(MapArrivalCardsResource, input)); });
    input.remoteAutoCompleteDestIdsRef.current.add('a');
    addTimers(input);
    act(() => tree?.update(React.createElement(MapArrivalCardsResource, { ...input, arrivalExitContext: 'other-scope' })));
    expect(input.remoteAutoCompleteDestIdsRef.current.size).toBe(0);
    expect(input.arrivalExitContextRef.current).toBe('other-scope');
    expect(jest.getTimerCount()).toBe(0);
    addTimers(input);
    act(() => tree?.unmount());
    tree = undefined;
    expect(jest.getTimerCount()).toBe(0);
  });
});
