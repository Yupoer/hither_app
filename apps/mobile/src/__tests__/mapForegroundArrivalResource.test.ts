import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { BackgroundManualUndoMarker } from '../state/backgroundJourney';
import { MapForegroundArrivalResource, type MapForegroundArrivalInput } from '../screens/MapScreen/MapForegroundArrivalResource';
import { createArrivalState } from '../utils/navigationArrival';

const mockReads: { session: string; finish: (marker: BackgroundManualUndoMarker | null) => void }[] = [];
jest.mock('../state/backgroundJourney', () => ({
  loadBackgroundManualUndo: (_actor: string, _group: string, _destination: string, session: string) =>
    new Promise<BackgroundManualUndoMarker | null>(finish => { mockReads.push({ session, finish }); }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function inputFor(session: string): MapForegroundArrivalInput {
  return {
    foregroundArrivalRef: { current: null }, foregroundAckRef: { current: null }, autoArrivalMarkedRef: { current: null },
    automaticArrivalRetryAt: { current: 0 }, arrivalFeedbackShownRef: { current: null },
    manualUndoSuppressedRef: { current: new Map() }, foregroundUndoHydrationRef: { current: { key: '', pending: false } },
    foregroundUndoHydrationKey: `group:actor:main:${session}:destination:${session}`,
    groupId: 'group', user: { id: 'actor' }, navTarget: { id: 'destination' },
    currentArrivalNavigationSessionId: session, setArrivalCelebrateDestId: jest.fn(),
    arrivalContext: `group:actor:main:${session}`, arrivalSessionKey: session,
    foregroundUndoHydrationSequenceRef: { current: 0 }, foregroundUndoMutationSequenceRef: { current: 0 },
    incomingArrivalHandlerRef: { current: jest.fn() }, arrivalOperations: [], evaluateForegroundArrival: jest.fn(),
  };
}

function markerFor(session: string): BackgroundManualUndoMarker {
  return { actorId: 'actor', groupId: 'group', destinationId: 'destination', navigationSessionId: session,
    operationId: 'operation', occurredAt: '2026-10-22T00:00:00.000Z', suppressed: true };
}

describe('Map foreground arrival ownership', () => {
  let tree: ReactTestRenderer | undefined;
  beforeEach(() => { mockReads.length = 0; });
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

  it('resets and starts undo hydration before evaluation even when the evaluation resource mounts first', async () => {
    const input = inputFor('a');
    const observed: { key: string; pending: boolean; arrival: unknown }[] = [];
    input.evaluateForegroundArrival = () => observed.push({ ...input.foregroundUndoHydrationRef.current, arrival: input.foregroundArrivalRef.current });
    act(() => { tree = create(React.createElement(MapForegroundArrivalResource, input)); });
    expect(mockReads.map(row => row.session)).toEqual(['a']);
    expect(observed).toEqual([{ key: input.foregroundUndoHydrationKey, pending: true, arrival: null }]);
    input.foregroundArrivalRef.current = { key: 'old', state: createArrivalState(100), sampledAtMs: 10 };
    const next = { ...input, currentArrivalNavigationSessionId: 'b', arrivalContext: 'context-b', arrivalSessionKey: 'b',
      foregroundUndoHydrationKey: 'hydration-b', evaluateForegroundArrival: () => {
        observed.push({ ...input.foregroundUndoHydrationRef.current, arrival: input.foregroundArrivalRef.current });
      } };
    act(() => tree?.update(React.createElement(MapForegroundArrivalResource, next)));
    expect(mockReads.map(row => row.session)).toEqual(['a', 'b']);
    expect(observed.at(-1)).toEqual({ key: 'hydration-b', pending: true, arrival: null });
    await act(async () => { mockReads[0].finish(markerFor('a')); });
    expect(input.manualUndoSuppressedRef.current.size).toBe(0);
    expect(input.foregroundUndoHydrationRef.current.pending).toBe(true);
    await act(async () => { mockReads[1].finish(markerFor('b')); });
    expect(input.manualUndoSuppressedRef.current.get('b:destination:actor')).toEqual(markerFor('b'));
    expect(input.foregroundUndoHydrationRef.current.pending).toBe(false);
    expect(input.incomingArrivalHandlerRef.current).toHaveBeenCalledTimes(1);
  });

  it('retains every outbox array identity without adding callback-only hydration restarts', async () => {
    const input = inputFor('a');
    act(() => { tree = create(React.createElement(MapForegroundArrivalResource, input)); });
    act(() => tree?.update(React.createElement(MapForegroundArrivalResource, { ...input })));
    expect(mockReads).toHaveLength(1);
    const evaluate = jest.fn();
    act(() => tree?.update(React.createElement(MapForegroundArrivalResource, { ...input, evaluateForegroundArrival: evaluate })));
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(mockReads).toHaveLength(1);
    act(() => tree?.update(React.createElement(MapForegroundArrivalResource, { ...input, arrivalOperations: [] })));
    expect(mockReads).toHaveLength(2);
    await act(async () => { mockReads[0].finish(markerFor('a')); });
    expect(input.manualUndoSuppressedRef.current.size).toBe(0);
    await act(async () => { mockReads[1].finish(null); });
    expect(input.foregroundUndoHydrationRef.current.pending).toBe(false);
  });

  it('lets a newer foreground undo mutation win over a late persisted marker', async () => {
    const input = inputFor('a');
    act(() => { tree = create(React.createElement(MapForegroundArrivalResource, input)); });
    const released = { ...markerFor('a'), suppressed: false };
    input.foregroundUndoMutationSequenceRef.current += 1;
    input.manualUndoSuppressedRef.current.set('a:destination:actor', released);
    await act(async () => { mockReads[0].finish(markerFor('a')); });
    expect(input.manualUndoSuppressedRef.current.get('a:destination:actor')).toBe(released);
    expect(input.foregroundUndoHydrationRef.current.pending).toBe(false);
    expect(input.incomingArrivalHandlerRef.current).toHaveBeenCalledTimes(1);
  });

  it('fences Strict replay reads and unmounts without late callbacks or suppression writes', async () => {
    const input = inputFor('a');
    act(() => { tree = create(React.createElement(React.StrictMode, null, React.createElement(MapForegroundArrivalResource, input))); });
    expect(mockReads).toHaveLength(2);
    act(() => tree?.unmount());
    tree = undefined;
    await act(async () => { for (const row of mockReads) row.finish(markerFor('a')); });
    expect(input.manualUndoSuppressedRef.current.size).toBe(0);
    expect(input.incomingArrivalHandlerRef.current).not.toHaveBeenCalled();
  });
});
