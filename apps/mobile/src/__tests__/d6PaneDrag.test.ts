import React from 'react';
import type { ScrollHandler } from 'react-native-reanimated';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { subscribeGestureFailures } from '../screens/MapScreen/components/d6GestureGuard';
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
const mockSprings: Spring[] = [];
const mockCancel = jest.fn();
const mockScrollTo = jest.fn();
let mockScrollHandler: ScrollHandler = () => {};
type Handlers = typeof mockHandlers;
const mockPanHandlers = new WeakMap<object, Handlers>();
const mockPanEnabled = new WeakMap<object, boolean>();
type TouchPosition = { absoluteY: number };
const mockHandlers = {
  down: (_event: { allTouches: TouchPosition[] }) => {},
  start: (_event: Drag & TouchPosition) => {}, update: (_event: Drag) => {}, end: (_event: Drag, _success: boolean) => {}, finalize: () => {},
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
      return shared;
    })[0];
  },
  useAnimatedRef: () => {
    const { useState } = jest.requireActual<typeof import('react')>('react');
    return useState(() => () => true)[0];
  },
  useAnimatedScrollHandler: (handler: ScrollHandler) => { mockScrollHandler = handler; return handler; },
  scrollTo: (...args: unknown[]) => mockScrollTo(...args),
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
    Native: () => ({ disallowInterruption() { return this; } }),
    Pan: () => {
      const handlers = { ...mockHandlers };
      const gesture = {
        enabled: (enabled: boolean) => { mockPanEnabled.set(gesture, enabled); return gesture; },
        activeOffsetY: () => gesture,
        failOffsetX: () => gesture,
        maxPointers: () => gesture,
        cancelsTouchesInView: () => gesture,
        onTouchesDown: (callback: typeof mockHandlers.down) => { handlers.down = mockHandlers.down = callback; return gesture; },
        simultaneousWithExternalGesture: () => gesture,
        onStart: (callback: typeof mockHandlers.start) => { handlers.start = mockHandlers.start = callback; return gesture; },
        onUpdate: (callback: typeof mockHandlers.update) => { handlers.update = mockHandlers.update = callback; return gesture; },
        onEnd: (callback: typeof mockHandlers.end) => { handlers.end = mockHandlers.end = callback; return gesture; },
        onFinalize: (callback: typeof mockHandlers.finalize) => { handlers.finalize = mockHandlers.finalize = callback; return gesture; },
      };
      mockPanHandlers.set(gesture, handlers);
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
function height() { return panel().height; }
function startChrome(gesture: Handlers, activationTravel = 0) {
  gesture.down({ allTouches: [{ absoluteY: 20 }] });
  gesture.start({ absoluteY: 20 + activationTravel, translationY: 0, velocityY: 0 });
}
function startContent(gesture: Handlers) {
  gesture.start({ absoluteY: 20, translationY: 0, velocityY: 0 });
}

function spring(): Spring {
  const value = mockSprings.at(-1);
  if (!value) throw new Error('Spring is not initialized');
  return value;
}
beforeEach(() => {
  mockNative = true; mockVisible = true; mockSprings.length = 0; renders = 0;
  jest.clearAllMocks();
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

it.each([1, -1] satisfies (1 | -1)[])('regrabs the actual intermediate spring position and drags without React renders in direction %s', direction => {
  render({ direction });
  act(() => panel().snapTo('full'));
  height().value = 250;
  act(() => startChrome(mockHandlers));
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
  act(() => startChrome(mockHandlers));
  act(() => closing.completion?.(true));
  expect(panel().preview).toBe(true);
  act(() => mockHandlers.end({ translationY: -100, velocityY: -100 }, true));
  act(() => mockHandlers.finalize());
  act(() => spring().completion?.(true));
  expect(panel().detent).toBe('closed');
  expect(panel().preview).toBe(false);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('allows a long drag to cross both detents and ignores velocity without travel', () => {
  render();
  act(() => startChrome(mockHandlers));
  act(() => mockHandlers.update({ translationY: 900, velocityY: 0 }));
  expect(mockReadHeight()).toBe(620);
  act(() => mockHandlers.end({ translationY: 900, velocityY: 2000 }, true));
  expect(panel().detent).toBe('full');
  expect(spring().next).toBe(620);
  height().value = 300;
  act(() => startChrome(mockHandlers));
  act(() => mockHandlers.end({ translationY: 0, velocityY: 400 }, true));
  expect(panel().detent).toBe('full');
  expect(spring().next).toBe(620);
});

it.each([1, -1] satisfies (1 | -1)[])('moves one detent per light chrome flick and ignores small slow movements, direction %s', direction => {
  render({ direction });
  function release(travel: number, speed: number) {
    const gesture = mockPanHandlers.get(direction === 1 ? panel().headerGesture : panel().footerGesture);
    if (!gesture) throw new Error('Chrome gesture is missing');
    const activationTravel = Math.sign(travel) * Math.min(Math.abs(travel), 5);
    const event = { translationY: direction * (travel - activationTravel), velocityY: direction * speed };
    act(() => startChrome(gesture, direction * activationTravel));
    act(() => gesture.update(event));
    act(() => gesture.end(event, true));
    act(() => gesture.finalize());
  }
  release(3, 900);
  expect(panel().detent).toBe('closed');
  height().value = 100;
  release(6, 100);
  expect(panel().detent).toBe('closed');
  height().value = 100;
  release(9, 100);
  expect(panel().detent).toBe('half');
  height().value = 349.6;
  release(7, 360);
  expect(panel().detent).toBe('full');
  height().value = 620;
  release(-7, -360);
  expect(panel().detent).toBe('half');
  height().value = 349.6;
  release(-9, -100);
  expect(panel().detent).toBe('closed');
  expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
});

it('mounts independent header, footer and grabber pans sharing one height and cancels actions after a drag', () => {
  render();
  expect(new Set([panel().headerGesture, panel().footerGesture, panel().gesture]).size).toBe(3);
  height().value = 200;
  const header = mockPanHandlers.get(panel().headerGesture);
  const footer = mockPanHandlers.get(panel().footerGesture);
  if (!header || !footer) throw new Error('Chrome gestures are missing');
  act(() => startChrome(header));
  act(() => header.update({ translationY: 30, velocityY: 0 }));
  expect(height().get()).toBe(230);
  expect(panel().pressCancelled.get()).toBe(true);
  act(() => header.finalize());
  height().value = 230;
  act(() => startChrome(footer));
  act(() => footer.update({ translationY: 20, velocityY: 0 }));
  expect(height().get()).toBe(250);
  act(() => footer.finalize());
  expect(panel().owner.get()).toBe('idle');
  expect(panel().pressCancelled.get()).toBe(true);
});

it('leaves pane height and scroll offset unchanged while reorder owns the touch', () => {
  render({ open: true });
  height().value = 350;
  act(() => scrollContent(90));
  panel().owner.set('reorder');
  act(() => startChrome(mockHandlers));
  act(() => mockHandlers.update({ translationY: 70, velocityY: 0 }));
  const content = contentHandlers();
  act(() => startContent(content));
  act(() => content.update({ translationY: 70, velocityY: 0 }));
  act(() => scrollContent(200));
  expect(height().get()).toBe(350);
  expect(panel().owner.get()).toBe('reorder');
  expect(mockScrollTo).toHaveBeenLastCalledWith(expect.any(Function), 0, 90, false);
  expect(onDragBegin).not.toHaveBeenCalled();
});

it('keeps the content layout fixed through a settled half detent and a regrab', () => {
  render();
  act(() => panel().snapTo('half'));
  const half = spring();
  expect(panel().layoutHeight).toBe(620);
  act(() => half.completion?.(true));
  expect(panel().layoutHeight).toBe(620);
  act(() => startChrome(mockHandlers));
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
  expect(panel().layoutHeight).toBe(400);
});

it.each([1, -1] satisfies (1 | -1)[])('hands content scrolling into collapse using only motion beyond the edge, direction %s', direction => {
  render({ direction, open: true });
  height().value = 350;
  const handlers = contentHandlers();
  const edge = direction === 1 ? 570 : 0;
  act(() => scrollContent(edge - direction * 30));
  act(() => startContent(handlers));
  act(() => scrollContent(edge - direction * 18));
  act(() => handlers.update({ translationY: -direction * 12, velocityY: 0 }));
  expect(height().get()).toBe(350);
  expect(mockScrollTo).not.toHaveBeenCalled();
  expect(onDragBegin).not.toHaveBeenCalled();
  act(() => scrollContent(edge));
  act(() => handlers.update({ translationY: -direction * 36, velocityY: 0 }));
  expect(height().get()).toBe(344);
  expect(mockScrollTo).toHaveBeenLastCalledWith(expect.any(Function), 0, direction === 1 ? 576 : 0, false);
  expect(onDragBegin).toHaveBeenCalledTimes(1);
  act(() => handlers.end({ translationY: -direction * 36, velocityY: -direction * 360 }, true));
  act(() => handlers.finalize());
  expect(panel().detent).toBe('closed');
  expect(onOpenChange.mock.calls).toEqual([[false]]);
  expect(spring().next).toBe(100);
});

it.each([1, -1] satisfies (1 | -1)[])('scrolls to the edge before expanding and restores an interrupted drag, direction %s', direction => {
  render({ direction, open: true });
  height().value = 350;
  const handlers = contentHandlers();
  const edge = direction === 1 ? 0 : 570;
  act(() => scrollContent(edge + direction * 30));
  act(() => startContent(handlers));
  act(() => scrollContent(edge + direction * 18));
  act(() => handlers.update({ translationY: direction * 12, velocityY: 0 }));
  expect(height().get()).toBe(350);
  expect(mockScrollTo).not.toHaveBeenCalled();
  act(() => scrollContent(edge));
  act(() => handlers.update({ translationY: direction * 40, velocityY: 0 }));
  expect(height().get()).toBe(360);
  expect(mockScrollTo).toHaveBeenLastCalledWith(expect.any(Function), 0, direction === 1 ? 0 : 560, false);
  act(() => handlers.finalize());
  expect(spring().next).toBe(349.6);
});

it.each([true, false])('stops the spring in background and retains the selected detent on resume, native %s', native => {
  mockNative = native;
  render({ open: true });
  act(() => panel().snapTo('full'));
  height().value = 255;
  act(() => startChrome(mockHandlers));
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

function contentHandlers() {
  const handlers = mockPanHandlers.get(panel().contentGesture);
  if (!handlers) throw new Error('Content gesture is missing');
  return handlers;
}
function scrollContent(y: number) {
  mockScrollHandler({
    eventName: 'onScroll', contentInset: { top: 0, left: 0, bottom: 0, right: 0 }, zoomScale: 1,
    contentOffset: { x: 0, y }, contentSize: { width: 320, height: 800 },
    layoutMeasurement: { width: 320, height: 500 },
  }, {});
}

it.each([1, -1] satisfies (1 | -1)[])('scrolls full-detent overflow and can collapse at the opposite edge in one touch, direction %s', direction => {
  render({ direction, open: true });
  height().value = 350;
  act(() => scrollContent(direction === 1 ? 0 : 570));
  const handlers = contentHandlers();
  act(() => startContent(handlers));
  act(() => handlers.update({ translationY: direction * 330, velocityY: 0 }));
  expect(height().get()).toBe(620);
  expect(mockScrollTo).toHaveBeenLastCalledWith(expect.any(Function), 0, direction === 1 ? 0 : 300, false);
  act(() => handlers.update({ translationY: -direction * 10, velocityY: 0 }));
  expect(height().get()).toBe(580);
  expect(mockScrollTo).toHaveBeenLastCalledWith(expect.any(Function), 0, direction === 1 ? 340 : 0, false);
  act(() => handlers.update({ translationY: direction * 30, velocityY: 0 }));
  expect(height().get()).toBe(620);
  expect(mockScrollTo).toHaveBeenLastCalledWith(expect.any(Function), 0, direction === 1 ? 300 : 0, false);
  expect(onDragBegin).toHaveBeenCalledTimes(1);
  act(() => handlers.end({ translationY: direction * 30, velocityY: 0 }, true));
  act(() => handlers.finalize());
  expect(panel().detent).toBe('full');
});

it.each([1, -1] satisfies (1 | -1)[])('does not let native scroll events replace the offset owned by the content gesture, direction %s', direction => {
  render({ direction, open: true });
  height().value = 350;
  act(() => scrollContent(direction === 1 ? 0 : 570));
  const handlers = contentHandlers();
  act(() => startContent(handlers));
  act(() => handlers.update({ translationY: direction * 10, velocityY: 0 }));
  act(() => handlers.update({ translationY: direction * 330, velocityY: 0 }));
  act(() => scrollContent(direction === 1 ? 100 : 200));
  expect(mockScrollTo).toHaveBeenLastCalledWith(expect.any(Function), 0, direction === 1 ? 0 : 300, false);
  act(() => handlers.update({ translationY: direction * 340, velocityY: 0 }));
  expect(mockScrollTo).toHaveBeenLastCalledWith(expect.any(Function), 0, direction === 1 ? 0 : 300, false);
  act(() => handlers.finalize());
  expect(spring().next).toBe(349.6);
  mockScrollTo.mockClear();
  act(() => scrollContent(120));
  expect(mockScrollTo).not.toHaveBeenCalled();
});

it.each(['background', 'resize'] satisfies ('background' | 'resize')[])('cancels content ownership on %s and ignores stale events', change => {
  render({ direction: -1, open: true });
  height().value = 350;
  const handlers = contentHandlers();
  act(() => scrollContent(570));
  act(() => startContent(handlers));
  act(() => handlers.update({ translationY: -90, velocityY: 0 }));
  expect(height().get()).toBe(440);
  mockVisible = change !== 'background';
  render({ direction: -1, open: true, full: change === 'resize' ? 400 : 620, reduceMotion: true });
  const expected = change === 'resize' ? 244 : 349.6;
  expect(height().get()).toBe(expected);
  act(() => handlers.update({ translationY: -200, velocityY: 0 }));
  act(() => handlers.end({ translationY: -200, velocityY: -900 }, true));
  act(() => handlers.finalize());
  expect(height().get()).toBe(expected);
  expect(panel().detent).toBe('half');
  expect(onOpenChange).not.toHaveBeenCalled();
  mockVisible = true;
  render({ direction: -1, open: true, reduceMotion: true });
  height().value = 300;
  const resumed = contentHandlers();
  act(() => scrollContent(620));
  act(() => startContent(resumed));
  act(() => resumed.update({ translationY: -10, velocityY: 0 }));
  act(() => resumed.update({ translationY: -30, velocityY: 0 }));
  expect(height().get()).toBe(330);
});

it.each([1, -1] satisfies (1 | -1)[])('leaves an untouched full sheet under native scroll control, direction %s', direction => {
  render({ direction, open: true });
  act(() => panel().snapTo('full'));
  height().value = 620;
  act(() => scrollContent(150));
  const handlers = contentHandlers();
  act(() => startContent(handlers));
  act(() => handlers.update({ translationY: direction * 50, velocityY: 0 }));
  act(() => scrollContent(150 - direction * 50));
  act(() => handlers.update({ translationY: 0, velocityY: 0 }));
  act(() => handlers.end({ translationY: 0, velocityY: 0 }, true));
  act(() => handlers.finalize());
  expect(height().get()).toBe(620);
  expect(mockScrollTo).not.toHaveBeenCalled();
  expect(onDragBegin).not.toHaveBeenCalled();
});

it.each([true, false])('regrabs content at its presentation height and restores unsuccessful release, native %s', native => {
  mockNative = native;
  render({ direction: -1, open: true });
  act(() => panel().snapTo('full'));
  height().value = 270;
  act(() => scrollContent(native ? 650 : 300));
  const handlers = contentHandlers();
  act(() => startContent(handlers));
  act(() => handlers.update({ translationY: -10, velocityY: 0 }));
  const before = renders;
  act(() => handlers.update({ translationY: -50, velocityY: 0 }));
  expect(height().get()).toBe(320);
  expect(renders).toBe(before);
  act(() => handlers.end({ translationY: -50, velocityY: -900 }, false));
  act(() => handlers.finalize());
  expect(spring().next).toBe(620);
  act(() => handlers.update({ translationY: -100, velocityY: 0 }));
  expect(height().get()).toBe(320);
  expect(panel().detent).toBe('full');
});

it.each([1, -1] satisfies (1 | -1)[])('reverses immediately after overshooting the closed bound, direction %s', direction => {
  render({ direction, open: true });
  height().value = 350;
  act(() => scrollContent(direction === 1 ? 570 : 0));
  const handlers = contentHandlers();
  act(() => startContent(handlers));
  act(() => handlers.update({ translationY: -direction * 10, velocityY: 0 }));
  act(() => handlers.update({ translationY: -direction * 600, velocityY: 0 }));
  expect(height().get()).toBe(100);
  act(() => handlers.update({ translationY: -direction * 580, velocityY: 0 }));
  expect(height().get()).toBe(120);
  act(() => handlers.end({ translationY: -direction * 580, velocityY: 0 }, true));
  expect(panel().detent).toBe('closed');
  expect(onOpenChange).toHaveBeenCalledWith(false);
});


it('leaves an active drag untouched when another chrome recognizer did not acquire it', () => {
  render();
  const active = mockPanHandlers.get(panel().headerGesture);
  const rejected = mockPanHandlers.get(panel().footerGesture);
  if (!active || !rejected) throw new Error('Chrome gestures are missing');
  act(() => startChrome(active));
  act(() => active.update({ translationY: 50, velocityY: 0 }));
  expect(height().get()).toBe(150);
  act(() => startChrome(rejected));
  act(() => rejected.update({ translationY: 400, velocityY: 0 }));
  act(() => rejected.finalize());
  expect(height().get()).toBe(150);
  expect(panel().owner.get()).toBe('pane');
  act(() => active.update({ translationY: 80, velocityY: 0 }));
  expect(height().get()).toBe(180);
  act(() => active.end({ translationY: 80, velocityY: 0 }, true));
  expect(panel().owner.get()).toBe('idle');
});

it('opens at the requested itinerary height and leaves a mid-list swipe to native scrolling', () => {
  render({ open: true, openHeight: 550, reduceMotion: true });
  expect(height().get()).toBe(550);
  expect(mockPanEnabled.get(panel().contentGesture)).toBe(true);
  const handlers = contentHandlers();
  act(() => scrollContent(110));
  act(() => startContent(handlers));
  act(() => scrollContent(50));
  act(() => handlers.update({ translationY: 60, velocityY: 0 }));
  act(() => handlers.end({ translationY: 60, velocityY: 0 }, true));
  act(() => handlers.finalize());
  expect(height().get()).toBe(550);
  expect(mockScrollTo).not.toHaveBeenCalled();
});

it('preserves a full detent when another sheet temporarily owns interaction', () => {
  render({ open: true, reduceMotion: true });
  const pendingSnap = panel().snapTo;
  act(() => panel().snapTo('full'));
  render({ open: true, enabled: false, reduceMotion: true });
  expect(mockPanEnabled.get(panel().gesture)).toBe(false);
  act(() => pendingSnap('closed'));
  expect(onOpenChange).not.toHaveBeenCalled();
  render({ open: true, reduceMotion: true });
  expect(panel().detent).toBe('full');
  expect(height().get()).toBe(620);
  expect(mockPanEnabled.get(panel().gesture)).toBe(true);
});

it('keeps an active chrome drag when only the open height changes and snaps against the new open height', () => {
  render({ open: true, openHeight: 300, reduceMotion: true });
  act(() => startChrome(mockHandlers));
  act(() => mockHandlers.update({ translationY: 40, velocityY: 0 }));
  expect(height().get()).toBe(340);
  const springs = mockSprings.length;
  render({ open: true, openHeight: 360, reduceMotion: true });
  expect(height().get()).toBe(340);
  expect(panel().owner.get()).toBe('pane');
  expect(mockSprings).toHaveLength(springs);
  act(() => mockHandlers.update({ translationY: 65, velocityY: 0 }));
  expect(height().get()).toBe(365);
  act(() => mockHandlers.end({ translationY: 65, velocityY: 0 }, true));
  act(() => mockHandlers.finalize());
  expect(panel().owner.get()).toBe('idle');
  expect(panel().detent).toBe('half');
  expect(height().get()).toBe(360);
});

it('recovers a chrome drag whose update throws and reports the failing gesture', () => {
  Object.assign(globalThis, { __DEV__: false });
  const failures = jest.fn();
  const unsubscribe = subscribeGestureFailures(failures);
  render({ open: true });
  height().value = 349.6;
  act(() => startChrome(mockHandlers));
  const shared = height();
  const set = shared.set;
  shared.set = () => { shared.set = set; throw new Error('detached view'); };
  expect(() => act(() => mockHandlers.update({ translationY: 40, velocityY: 0 }))).not.toThrow();
  unsubscribe();
  expect(failures).toHaveBeenCalledWith('pane-chrome-update', 'Error: detached view');
  expect(panel().owner.get()).toBe('idle');
  expect(spring().next).toBe(349.6);
  act(() => mockHandlers.update({ translationY: 120, velocityY: 0 }));
  act(() => mockHandlers.end({ translationY: 120, velocityY: 2000 }, true));
  expect(height().get()).toBe(349.6);
  expect(panel().detent).toBe('half');
  expect(onOpenChange).not.toHaveBeenCalled();
});
