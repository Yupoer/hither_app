import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useD6PaneDrag } from '../screens/MapScreen/components/useD6PaneDrag';

let mockNative = true;
let mockVisible = true;
let mockReadHeight: () => number | null = () => null;
let mockDeliverHeight = () => {};
const mockCommand = jest.fn((_ref: unknown, _name: string, _args: unknown[]) => {});
let mockStyle: () => { height?: number } = () => ({});
type Spring = { next: number; completion?: (finished: boolean) => void };
type Shared = { value: unknown; get: () => unknown; set: (next: unknown) => void };
type Drag = { translationY: number; velocityY: number };
const mockShared: Shared[] = [];
const mockSprings: Spring[] = [];
const mockCancel = jest.fn();
const mockHandlers = {
  start: () => {}, update: (_event: Drag) => {}, end: (_event: Drag, _success: boolean) => {}, finalize: () => {},
};
jest.mock('../native/d6Pane', () => ({ get nativeD6PaneAvailable() { return mockNative; } }));
jest.mock('../state/foregroundUi', () => ({ useVisibleUi: () => mockVisible }));
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (initial: unknown) => {
    const { useState } = jest.requireActual<typeof import('react')>('react');
    return useState(() => {
      const shared: Shared = {
        value: initial,
        get: () => shared.value,
        set: next => { if (!mockSprings.some(spring => spring === next)) shared.value = next; },
      };
      mockShared.push(shared);
      return shared;
    })[0];
  },
  useAnimatedRef: () => () => true,
  useAnimatedReaction: (reader: typeof mockReadHeight, deliver: (height: number | null) => void) => {
    mockReadHeight = reader;
    mockDeliverHeight = () => deliver(reader());
  },
  dispatchCommand: (ref: unknown, name: string, args: unknown[]) => mockCommand(ref, name, args),
  useAnimatedStyle: (reader: typeof mockStyle) => { mockStyle = reader; return {}; },
  cancelAnimation: (shared: Shared) => mockCancel(shared),
  runOnJS: (callback: unknown) => callback,
  runOnUI: (callback: unknown) => callback,
  withSpring: (next: number, _config: unknown, completion?: Spring['completion']) => {
    const spring = { next, completion };
    mockSprings.push(spring);
    return spring;
  },
}));
jest.mock('react-native-gesture-handler', () => ({
  Gesture: {
    Pan: () => {
      const gesture = {
        activeOffsetY: () => gesture,
        failOffsetX: () => gesture,
        onStart: (callback: typeof mockHandlers.start) => { mockHandlers.start = callback; return gesture; },
        onUpdate: (callback: typeof mockHandlers.update) => { mockHandlers.update = callback; return gesture; },
        onEnd: (callback: typeof mockHandlers.end) => { mockHandlers.end = callback; return gesture; },
        onFinalize: (callback: typeof mockHandlers.finalize) => { mockHandlers.finalize = callback; return gesture; },
      };
      return gesture;
    },
  },
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let renderer: ReactTestRenderer | undefined;
let renders = 0;
const onOpenChange = jest.fn();
const onDragBegin = jest.fn();
type Options = Partial<Parameters<typeof useD6PaneDrag>[0]>;
function Probe(_props: { panel: ReturnType<typeof useD6PaneDrag> }) { return null; }
function Harness(options: Options) {
  renders++;
  const panel = useD6PaneDrag({ closed: 100, full: 620, direction: 1, open: false,
    reduceMotion: false, onOpenChange, onDragBegin, ...options });
  return React.createElement(React.Fragment, null, panel.lifecycle, React.createElement(Probe, { panel }));
}
function render(options: Options = {}) {
  act(() => {
    const element = React.createElement(Harness, options);
    if (renderer) renderer.update(element); else renderer = create(element);
  });
}
function panel(): ReturnType<typeof useD6PaneDrag> {
  if (!renderer) throw new Error('Panel is not mounted');
  return renderer.root.findByType(Probe).props.panel;
}
function height(): Shared {
  const value = mockShared[2];
  if (!value) throw new Error('Height is not initialized');
  return value;
}
function spring(): Spring {
  const value = mockSprings.at(-1);
  if (!value) throw new Error('Spring is not initialized');
  return value;
}
beforeEach(() => {
  mockNative = true; mockVisible = true; mockShared.length = 0; mockSprings.length = 0; renders = 0;
  jest.clearAllMocks();
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

it.each([1, -1] satisfies (1 | -1)[])('regrabs the actual intermediate spring position and drags without React renders in direction %s', direction => {
  render({ direction });
  act(() => panel().snapTo('full'));
  height().value = 250;
  act(() => mockHandlers.start());
  const before = renders;
  act(() => mockHandlers.update({ translationY: 40, velocityY: 0 }));
  expect(mockCancel).toHaveBeenCalledWith(height());
  mockDeliverHeight();
  expect(mockCommand).toHaveBeenLastCalledWith(expect.any(Function), 'setPanelHeight', [250 + direction * 40]);
  expect(mockStyle()).toEqual({});
  expect(renders).toBe(before);
  expect(panel().layoutHeight).toBe(620);
  expect(onDragBegin).toHaveBeenCalledTimes(1);
  act(() => mockHandlers.finalize());
  expect(spring().next).toBe(620);
});

it('keeps closing content until the spring completes and ignores an interrupted close completion', () => {
  render({ open: true });
  act(() => panel().snapTo('closed'));
  const closing = spring();
  expect(panel().preview).toBe(true);
  expect(panel().layoutHeight).toBe(620);
  height().value = 200;
  act(() => mockHandlers.start());
  act(() => closing.completion?.(true));
  expect(panel().preview).toBe(true);
  act(() => mockHandlers.end({ translationY: -100, velocityY: -100 }, true));
  act(() => mockHandlers.finalize());
  act(() => spring().completion?.(true));
  expect(panel().detent).toBe('closed');
  expect(panel().preview).toBe(false);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('preserves fling detents and clamps drag bounds', () => {
  render();
  act(() => mockHandlers.start());
  act(() => mockHandlers.update({ translationY: 900, velocityY: 0 }));
  expect(mockReadHeight()).toBe(620);
  act(() => mockHandlers.end({ translationY: 900, velocityY: 2000 }, true));
  expect(panel().detent).toBe('full');
  expect(spring().next).toBe(620);
  height().value = 300;
  act(() => mockHandlers.start());
  act(() => mockHandlers.end({ translationY: 0, velocityY: 400 }, true));
  expect(panel().detent).toBe('half');
  expect(spring().next).toBe(349.6);
});

it('changes React content dimensions only after the current spring settles and restores full layout before regrab', () => {
  render();
  act(() => panel().snapTo('half'));
  const half = spring();
  expect(panel().layoutHeight).toBe(620);
  act(() => half.completion?.(true));
  expect(panel().layoutHeight).toBe(349.6);
  act(() => mockHandlers.start());
  expect(panel().layoutHeight).toBe(620);
  act(() => half.completion?.(true));
  expect(panel().layoutHeight).toBe(620);
  act(() => panel().contentDidLayout());
  expect(mockCommand).toHaveBeenLastCalledWith(expect.any(Function), 'contentDidLayout', []);
});

it('reconciles external close, viewport resize and reduced motion', () => {
  render({ open: true });
  render({ open: false, reduceMotion: true });
  expect(height().get()).toBe(100);
  expect(panel().preview).toBe(false);
  render({ open: true, full: 400, reduceMotion: true });
  expect(height().get()).toBe(244);
  expect(panel().layoutHeight).toBe(244);
});

it.each([true, false])('stops the spring in background and retains the selected detent on resume, native %s', native => {
  mockNative = native;
  render({ open: true });
  act(() => panel().snapTo('full'));
  height().value = 255;
  act(() => mockHandlers.start());
  const before = mockSprings.length;
  mockVisible = false;
  render({ open: true });
  expect(mockCancel).toHaveBeenCalledWith(height());
  expect(height().get()).toBe(620);
  expect(panel().detent).toBe('full');
  expect(panel().preview).toBe(false);
  expect(mockSprings).toHaveLength(before);
  mockVisible = true;
  render({ open: true });
  expect(panel().detent).toBe('full');
  expect(spring().next).toBe(620);
  expect(onOpenChange).not.toHaveBeenCalled();
});

it('keeps the original animated-height path when the native container is unavailable', () => {
  mockNative = false;
  render();
  height().value = 225;
  expect(mockStyle()).toEqual({ height: 225 });
  expect(mockReadHeight()).toBeNull();
  mockDeliverHeight();
  expect(mockCommand).not.toHaveBeenCalled();
  act(() => panel().snapTo('full'));
  expect(panel().layoutHeight).toBe(100);
  expect(spring().next).toBe(620);
});
