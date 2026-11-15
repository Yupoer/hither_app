import { cancelledD6Touch, d6ActivationKind, claimD6Drag, releaseD6Drag, type D6DragOwner } from '../screens/MapScreen/components/d6DragOwnership';
import { d6DragTarget, d6DropDestination, type D6DragSession } from '../screens/MapScreen/components/d6RouteDrag';

function ownership(initial: D6DragOwner) {
  let value = initial;
  return {
    get: () => value,
    set: (next: D6DragOwner | ((previous: D6DragOwner) => D6DragOwner)) => {
      value = typeof next === 'function' ? next(value) : next;
    },
  };
}

it.each(['idle', 'pane', 'reorder'] satisfies D6DragOwner[])('allows exactly one owner from %s and preserves it on unrelated cleanup', initial => {
  for (const next of ['pane', 'reorder'] satisfies Exclude<D6DragOwner, 'idle'>[]) {
    const state = ownership(initial);
    expect(claimD6Drag(state, next)).toBe(initial === 'idle');
    expect(state.get()).toBe(initial === 'idle' ? next : initial);
    const holder = state.get();
    releaseD6Drag(state, next === 'pane' ? 'reorder' : 'pane');
    expect(state.get()).toBe(holder === (next === 'pane' ? 'reorder' : 'pane') ? 'idle' : holder);
    releaseD6Drag(state, next);
    expect(state.get()).toBe('idle');
  }
});

it('lets a cancelled reorder return control to the next pane drag', () => {
  const state = ownership('idle');
  expect(claimD6Drag(state, 'reorder')).toBe(true);
  expect(claimD6Drag(state, 'pane')).toBe(false);
  releaseD6Drag(state, 'reorder');
  expect(claimD6Drag(state, 'pane')).toBe(true);
  releaseD6Drag(state, 'reorder');
  expect(state.get()).toBe('pane');
});

const session: D6DragSession = {
  row: { kind: 'destination', id: 'a', destination: { id: 'a', title: 'A', day: 1, order: 0, coordinates: { latitude: 25, longitude: 121 } } },
  root: { x: 0, y: 0, width: 300, height: 500 },
  strip: { x: 0, y: 0, width: 300, height: 64 },
  overlay: { x: 0, y: 0 },
  source: { x: 0, y: 70, width: 300, height: 50 },
  offset: { x: 270, y: 25 },
  days: [{ day: 2, bounds: { x: 55, y: 0, width: 50, height: 64 } }],
  rows: [
    { id: 'b', bounds: { x: 0, y: 120, width: 300, height: 50 } },
    { id: 'c', bounds: { x: 0, y: 170, width: 300, height: 50 } },
  ],
};

it('moves the drop preview after crossing row midpoints and still supports another day', () => {
  expect(d6DragTarget(session, { x: 270, y: 144 })).toEqual({ kind: 'row', id: 'b', edge: 'above' });
  expect(d6DragTarget(session, { x: 270, y: 146 })).toEqual({ kind: 'row', id: 'c', edge: 'above' });
  expect(d6DragTarget(session, { x: 270, y: 196 })).toEqual({ kind: 'row', id: 'c', edge: 'below' });
  expect(d6DragTarget(session, { x: 80, y: 30 })).toEqual({ kind: 'day', day: 2 });
  expect(d6DragTarget(session, { x: 320, y: 150 })).toBeNull();
});

it('never commits a cancelled drag or a drag whose source or target disappeared', () => {
  expect(d6DropDestination(session, undefined, ['a', 'b', 'c'])).toBeNull();
  expect(d6DropDestination(null, { x: 270, y: 144 }, ['a', 'b', 'c'])).toBeNull();
  expect(d6DropDestination(session, { x: 270, y: 144 }, ['b', 'c'])).toBeNull();
  expect(d6DropDestination(session, { x: 270, y: 144 }, ['a', 'c'])).toBeNull();
  expect(d6DropDestination(session, { x: 270, y: 144 }, ['a', 'b', 'c'])).toEqual({ kind: 'row', id: 'b', edge: 'above' });
});

it('rejects a drop below the visible half-height pane even when rows continue below it', () => {
  const half = { ...session, root: { ...session.root, height: 160 } };
  expect(d6DragTarget(half, { x: 270, y: 159 })).toEqual({ kind: 'row', id: 'c', edge: 'above' });
  expect(d6DragTarget(half, { x: 270, y: 161 })).toBeNull();
  expect(d6DropDestination(half, { x: 270, y: 196 }, ['a', 'b', 'c'])).toBeNull();
});


it('blocks only the cancelled pointer activation and keeps accessibility activation available', () => {
  const touch = { nativeEvent: { changedTouches: [{ identifier: 1 }] } };
  const accessibility = { nativeEvent: { target: 1 } };
  expect(d6ActivationKind(touch)).toBe('touch');
  expect(d6ActivationKind(accessibility)).toBe('accessibility');
  expect(cancelledD6Touch(true, touch)).toBe(true);
  expect(cancelledD6Touch(false, touch)).toBe(false);
  expect(cancelledD6Touch(true, accessibility)).toBe(false);
  expect(cancelledD6Touch(true, undefined)).toBe(false);
});
