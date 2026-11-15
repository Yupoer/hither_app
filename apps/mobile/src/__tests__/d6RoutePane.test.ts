import React, { Profiler, useState } from 'react';
import { measure } from 'react-native-reanimated';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { D6RoutePane, type D6RoutePaneProps, type D6RouteSelection } from '../screens/MapScreen/components/D6RoutePane';
import type { Destination } from '../types';
import { D6RouteRow } from '../screens/MapScreen/components/D6RouteRow';

jest.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceTransparencyEnabled: async () => false,
    addEventListener: () => ({ remove: jest.fn() }),
  },
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: object) => styles, absoluteFill: {}, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: 'GestureHandlerRootView',
  GestureDetector: 'GestureDetector',
  Gesture: {
    Pan: () => ({
      callbacks: new Map<string, (...args: unknown[]) => void>(),
      enabled() { return this; },
      activateAfterLongPress() { return this; },
      maxPointers() { return this; },
      onTouchesDown() { return this; },
      onUpdate(callback: (...args: unknown[]) => void) { this.callbacks.set('update', callback); return this; },
      onFinalize(callback: (...args: unknown[]) => void) { this.callbacks.set('finalize', callback); return this; },
      blocksExternalGesture() { return this; },
      hitSlop() { return this; },
      activeOffsetX() { return this; },
      onStart(callback: (...args: unknown[]) => void) { this.callbacks.set('start', callback); return this; },
      onEnd(callback: (...args: unknown[]) => void) { this.callbacks.set('end', callback); return this; },
    }),
  },
}));
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({ __esModule: true, default: 'Swipeable' }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  runOnJS: (callback: () => void) => callback,
  measure: jest.fn(() => null),
  useAnimatedRef: () => {
    const { useState } = jest.requireActual<typeof import('react')>('react');
    return useState(() => () => null)[0];
  },
  useAnimatedStyle: (style: () => object) => style(),
  useDerivedValue: (compute: () => unknown) => {
    const { useRef, useState } = jest.requireActual<typeof import('react')>('react');
    const current = useRef(compute);
    current.current = compute;
    return useState(() => ({ get: () => current.current() }))[0];
  },
  useSharedValue: (initial: unknown) => {
    const { useState } = jest.requireActual<typeof import('react')>('react');
    return useState(() => {
      let value = initial;
      return {
        get: () => value,
        set: (next: unknown) => { value = next; },
        modify: (compute: (previous: unknown) => unknown) => { value = compute(value); },
      };
    })[0];
  },
  withTiming: (value: number) => value,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) }));
jest.mock('../components/SwiftUIGlassSurface', () => ({ __esModule: true, default: 'SwiftUIGlassSurface' }));
jest.mock('../utils/haptics', () => ({ lightTap: jest.fn() }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ language: 'zh', t: (key: string) => key }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stop = (id: string, day: number): Destination => ({
  id, title: id, day, order: 0, coordinates: { latitude: 25, longitude: 121 },
});

function mount(element: React.ReactElement) {
  return create(element, { createNodeMock: () => ({}) });
}

describe('D6 itinerary panel', () => {
  let renderer: ReactTestRenderer;
  let footer: D6RouteSelection | null;
  const onDelete = jest.fn(async () => true);
  const props: D6RoutePaneProps = {
    accent: '#4C6FFF',
    destinations: [stop('a', 1), stop('b', 1), stop('c', 2)],
    departureDate: '2026-11-01',
    tripDays: 2,
    selectedDay: 1,
    onSelectDay: jest.fn(),
    activeDestinationId: 'a',
    canEdit: true,
    dailyAccommodations: [],
    dayColors: {},
    onDayColor: jest.fn(),
    suggestions: [],
    onSuggestion: jest.fn(),
    onOpenStop: jest.fn(),
    onAdd: jest.fn(),
    onImport: jest.fn(),
    onReorder: jest.fn(async () => true),
    onDelete,
    onTripDetails: jest.fn(async () => true),
    onAccommodation: jest.fn(async () => true),
  };

  function Shell({ canEdit }: { canEdit: boolean }) {
    const [selection, setSelection] = useState<D6RouteSelection | null>(null);
    const [selectedDay, setSelectedDay] = useState(1);
    footer = selection;
    return React.createElement(D6RoutePane, {
      ...props, canEdit, selectedDay, onSelectDay: setSelectedDay,
      onSelectionChange: setSelection, dayColors: {},
    });
  }

  function byId(testID: string) {
    return renderer.root.findAllByProps({ testID })[0];
  }

  beforeEach(() => {
    footer = null;
    jest.clearAllMocks();
    jest.mocked(measure).mockReset().mockReturnValue(null);
    jest.useFakeTimers();
    globalThis.requestAnimationFrame = (fn) => Number(setTimeout(() => fn(0), 0));
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function measuredDrag() {
    const bounds = (x: number, y: number, width: number, height: number) => ({ x, y, pageX: x, pageY: y, width, height });
    jest.mocked(measure)
      .mockReturnValueOnce(bounds(0, 0, 300, 500))
      .mockReturnValueOnce(bounds(0, 0, 300, 64))
      .mockReturnValueOnce(bounds(0, 0, 300, 500))
      .mockReturnValueOnce(bounds(0, 70, 300, 54))
      .mockReturnValueOnce(bounds(0, 124, 300, 54));
    return byId('d6-route-drag-a').parent?.props.gesture.callbacks;
  }

  it('keeps an active contact on the UI thread and submits once after release despite an unrelated failed grip', async () => {
    const rendered = jest.fn();
    await act(async () => {
      renderer = mount(React.createElement(Profiler, { id: 'route', onRender: rendered }, React.createElement(Shell, { canEdit: true })));
    });
    const callbacks = measuredDrag();
    const other = byId('d6-route-drag-b').parent?.props.gesture.callbacks;
    rendered.mockClear();
    act(() => callbacks.get('start')({ absoluteX: 270, absoluteY: 95 }));
    act(() => callbacks.get('update')({ absoluteX: 270, absoluteY: 160 }));
    act(() => other.get('finalize')());
    expect(rendered).not.toHaveBeenCalled();
    await act(async () => {
      callbacks.get('end')({ absoluteX: 270, absoluteY: 160 }, true);
      callbacks.get('end')({ absoluteX: 270, absoluteY: 160 }, true);
      callbacks.get('finalize')();
    });
    expect(props.onReorder).toHaveBeenCalledTimes(1);
    expect(props.onReorder).toHaveBeenCalledWith(expect.arrayContaining([{ id: 'a', day: 1, position: 1 }]));
    expect(props.onOpenStop).not.toHaveBeenCalled();
  });

  it('keeps the mounted gesture and active session while publishing a same-scope callback update', async () => {
    await act(async () => { renderer = mount(React.createElement(D6RoutePane, props)); });
    const gesture = byId('d6-route-drag-a').parent?.props.gesture;
    const paneRef = byId('d6-route-pane').props.ref;
    const callbacks = measuredDrag();
    const row = renderer.root.findAllByType(D6RouteRow)[0];
    const owner = row.props.drag.owner;
    const rowRef = row.find(node => String(node.type) === 'AnimatedView' && typeof node.props.ref === 'function').props.ref;
    act(() => callbacks.get('start')({ absoluteX: 270, absoluteY: 95 }));
    act(() => { rowRef(null); rowRef({}); });
    expect(owner.get()).toBe('reorder');
    expect(props.onReorder).not.toHaveBeenCalled();
    const onReorder = jest.fn(async () => true);
    await act(async () => {
      renderer.update(React.createElement(D6RoutePane, { ...props, onReorder }));
    });
    expect(byId('d6-route-pane').props.ref).toBe(paneRef);
    expect(byId('d6-route-drag-a').parent?.props.gesture).toBe(gesture);
    expect(owner.get()).toBe('reorder');
    await act(async () => callbacks.get('end')({ absoluteX: 270, absoluteY: 160 }, true));
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it('rejects a queued release immediately when its native row detaches before passive cleanup', async () => {
    await act(async () => { renderer = mount(React.createElement(D6RoutePane, props)); });
    const callbacks = measuredDrag();
    const row = renderer.root.findAllByType(D6RouteRow)[0];
    const owner = row.props.drag.owner;
    const rowRef = row.find(node => String(node.type) === 'AnimatedView' && typeof node.props.ref === 'function').props.ref;
    act(() => callbacks.get('start')({ absoluteX: 270, absoluteY: 95 }));
    act(() => rowRef(null));
    expect(owner.get()).toBe('reorder');
    await act(async () => callbacks.get('end')({ absoluteX: 270, absoluteY: 160 }, true));
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(owner.get()).toBe('idle');
  });

  it('isolates a detached pane before passive cleanup and preserves ownership acquired by its replacement', async () => {
    await act(async () => { renderer = mount(React.createElement(D6RoutePane, props)); });
    const callbacks = measuredDrag();
    const row = renderer.root.findAllByType(D6RouteRow)[0];
    const owner = row.props.drag.owner;
    act(() => callbacks.get('start')({ absoluteX: 270, absoluteY: 95 }));
    const replacementCommit = jest.fn((view: object | null) => {
      if (!view) return;
      expect(owner.get()).toBe('idle');
      callbacks.get('end')({ absoluteX: 270, absoluteY: 160 }, true);
      expect(props.onReorder).not.toHaveBeenCalled();
      owner.set('reorder');
    });
    await act(async () => { renderer.update(React.createElement('View', { ref: replacementCommit })); });
    expect(replacementCommit).toHaveBeenCalledWith(expect.any(Object));
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(owner.get()).toBe('reorder');
  });

  it('releases ownership on unmount and ignores callbacks queued by the detached gesture', async () => {
    await act(async () => { renderer = mount(React.createElement(D6RoutePane, props)); });
    const callbacks = measuredDrag();
    const row = renderer.root.findAllByType(D6RouteRow)[0];
    const owner = row.props.drag.owner;
    act(() => callbacks.get('start')({ absoluteX: 270, absoluteY: 95 }));
    expect(owner.get()).toBe('reorder');
    act(() => renderer.unmount());
    expect(owner.get()).toBe('idle');
    await act(async () => callbacks.get('end')({ absoluteX: 270, absoluteY: 160 }, true));
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'day change'])('never commits a contact after %s', async interruption => {
    await act(async () => { renderer = mount(React.createElement(Shell, { canEdit: true })); });
    const callbacks = measuredDrag();
    act(() => callbacks.get('start')({ absoluteX: 270, absoluteY: 95 }));
    if (interruption === 'cancel') act(() => callbacks.get('finalize')());
    else act(() => byId('d6-route-day-2').props.onPress());
    await act(async () => callbacks.get('end')({ absoluteX: 270, absoluteY: 160 }, true));
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(props.onOpenStop).not.toHaveBeenCalled();
  });

  it('keeps the island selection in sync through parent rerenders and day changes', async () => {
    await act(async () => { renderer = mount(React.createElement(Shell, { canEdit: true })); });
    expect(footer).toBeNull();
    act(() => byId('d6-route-row-a').props.onLongPress());
    expect(footer?.count).toBe(1);
    act(() => byId('d6-route-row-a').props.onPress());
    act(() => byId('d6-route-row-b').props.onPress());
    expect(footer?.count).toBe(1);
    act(() => footer?.onDelete());
    await act(async () => { jest.advanceTimersByTime(220); });
    expect(onDelete).toHaveBeenCalledWith(['b']);
    expect(footer).toBeNull();
    act(() => byId('d6-route-row-a').props.onLongPress());
    act(() => byId('d6-route-day-2').props.onPress());
    expect(footer?.count).toBe(0);
    expect(byId('d6-route-row-c')).toBeDefined();
  });

  it('shows members the selected day without mounting edit gestures', async () => {
    await act(async () => { renderer = mount(React.createElement(Shell, { canEdit: false })); });
    expect(byId('d6-route-row-a').props.onLongPress).toBeUndefined();
    expect(byId('d6-route-drag-a')).toBeUndefined();
    expect(byId('d6-route-add-day')).toBeUndefined();
    expect(footer).toBeNull();
  });

  it('keeps daily and older accommodations in a separate section while regular stops can move past their stored position', async () => {
    const destinations: Destination[] = [
      stop('a', 1), { ...stop('old-bed', 1), order: 1, kind: 'accommodation' },
      { ...stop('b', 1), order: 2 },
    ];
    await act(async () => { renderer = mount(React.createElement(D6RoutePane, {
      ...props, destinations, dailyAccommodations: [{ id: 'daily-bed', groupId: 'g', stayDate: '2026-11-01',
        title: 'Hotel', coordinates: { latitude: 25, longitude: 121 } }],
    })); });
    const section = byId('d6-accommodation-section');
    expect(section.findAllByProps({ testID: 'd6-route-row-old-bed' })).not.toHaveLength(0);
    expect(section.findAllByProps({ testID: 'd6-route-row-daily-bed' })).not.toHaveLength(0);
    expect(section.findAllByProps({ testID: 'd6-route-row-a' })).toHaveLength(0);
    expect(byId('d6-route-drag-old-bed')).toBeUndefined();
    await act(async () => byId('d6-route-drag-a').props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(props.onReorder).toHaveBeenCalledWith([
      { id: 'old-bed', day: 1, position: 0 }, { id: 'b', day: 1, position: 1 }, { id: 'a', day: 1, position: 2 },
    ]);
  });
});
