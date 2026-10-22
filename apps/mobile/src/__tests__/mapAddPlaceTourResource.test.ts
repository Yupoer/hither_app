import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MapAddPlaceTourResource, type MapAddPlaceTourInput } from '../screens/MapScreen/MapAddPlaceTourResource';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const star = { x: 1, y: 2, width: 30, height: 40 };
const center = { x: 50, y: 2, width: 30, height: 40 };
function tourInput(): MapAddPlaceTourInput {
  return {
    addPlaceTourGenerationRef: { current: 0 }, confirmCardReady: true,
    pendingPlace: { id: 'place', name: 'Place', coordinates: { latitude: 25, longitude: 121 } },
    setAddPlaceTourStep: jest.fn(), setAddPlaceTourTargetRect: jest.fn(), setAddPlaceTourTransitioning: jest.fn(),
    measureTourTarget: jest.fn(async target => target === 'addPlaceCenter' ? center : star),
    addPlaceTourLocalDone: false, user: { preferences: {} }, addPlaceTourStep: null, confirmKeyboardHeight: 0,
  };
}

describe('Map add-place tour resources', () => {
  let tree: ReactTestRenderer | undefined;
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.useRealTimers(); });

  it('retains pending-place and preferences object identity and callback identity while leaving the owner mounted', async () => {
    const input = tourInput();
    act(() => { tree = create(React.createElement(MapAddPlaceTourResource, input)); });
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(input.setAddPlaceTourStep).toHaveBeenCalledWith(0);
    expect(input.measureTourTarget).toHaveBeenCalledTimes(2);
    act(() => tree?.update(React.createElement(MapAddPlaceTourResource, { ...input })));
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(input.measureTourTarget).toHaveBeenCalledTimes(2);
    const nextPlace = { ...input, pendingPlace: input.pendingPlace ? { ...input.pendingPlace } : null };
    act(() => tree?.update(React.createElement(MapAddPlaceTourResource, nextPlace)));
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(input.measureTourTarget).toHaveBeenCalledTimes(4);
    const nextPreferences = { ...nextPlace, user: { preferences: {} } };
    act(() => tree?.update(React.createElement(MapAddPlaceTourResource, nextPreferences)));
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(input.measureTourTarget).toHaveBeenCalledTimes(6);
    const nextMeasure = jest.fn(async () => star);
    act(() => tree?.update(React.createElement(MapAddPlaceTourResource, { ...nextPreferences, measureTourTarget: nextMeasure })));
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(nextMeasure).toHaveBeenCalledTimes(2);
  });

  it('publishes the start generation before same-commit measurement even when the measurement mounts first', async () => {
    const input = { ...tourInput(), addPlaceTourStep: 1 };
    await act(async () => { tree = create(React.createElement(MapAddPlaceTourResource, input)); });
    expect(input.setAddPlaceTourTargetRect).toHaveBeenLastCalledWith(center);
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(input.setAddPlaceTourStep).not.toHaveBeenCalledWith(0);
    expect(input.setAddPlaceTourTargetRect).toHaveBeenLastCalledWith(center);
    const next = { ...input, pendingPlace: input.pendingPlace ? { ...input.pendingPlace } : null, addPlaceTourStep: 0 };
    await act(async () => tree?.update(React.createElement(MapAddPlaceTourResource, next)));
    expect(input.setAddPlaceTourTargetRect).toHaveBeenLastCalledWith(star);
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(input.setAddPlaceTourTargetRect).toHaveBeenLastCalledWith(star);
  });

  it('ignores reverse measurement completions and cancels late output after unmount', async () => {
    const finishes: ((rect: typeof star) => void)[] = [];
    const input = { ...tourInput(), pendingPlace: null, confirmCardReady: false, addPlaceTourStep: 0,
      measureTourTarget: jest.fn(() => new Promise<typeof star>(resolve => finishes.push(resolve))) };
    await act(async () => { tree = create(React.createElement(MapAddPlaceTourResource, input)); });
    await act(async () => tree?.update(React.createElement(MapAddPlaceTourResource, { ...input, addPlaceTourStep: 1 })));
    await act(async () => { finishes[1](center); });
    expect(input.setAddPlaceTourTargetRect).toHaveBeenLastCalledWith(center);
    const calls = jest.mocked(input.setAddPlaceTourTargetRect).mock.calls.length;
    await act(async () => { finishes[0](star); });
    expect(input.setAddPlaceTourTargetRect).toHaveBeenCalledTimes(calls);
    await act(async () => tree?.update(React.createElement(MapAddPlaceTourResource, { ...input, addPlaceTourStep: 0 })));
    act(() => tree?.unmount());
    tree = undefined;
    await act(async () => { finishes[2](star); });
    expect(input.setAddPlaceTourTargetRect).toHaveBeenCalledTimes(calls);
  });

  it('keeps Strict replay cancellation and the original uncancelled settle timer semantics', async () => {
    const input = tourInput();
    act(() => { tree = create(React.createElement(React.StrictMode, null, React.createElement(MapAddPlaceTourResource, input))); });
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(input.setAddPlaceTourStep).toHaveBeenCalledTimes(1);
    act(() => tree?.update(React.createElement(React.StrictMode, null,
      React.createElement(MapAddPlaceTourResource, { ...input, pendingPlace: input.pendingPlace ? { ...input.pendingPlace } : null }))));
    act(() => tree?.unmount());
    tree = undefined;
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(input.setAddPlaceTourStep).toHaveBeenCalledTimes(1);
  });
});
