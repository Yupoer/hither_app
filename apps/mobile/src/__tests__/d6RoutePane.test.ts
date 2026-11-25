import React, { Profiler, useState } from 'react';
import { Platform } from 'react-native';
import { measure } from 'react-native-reanimated';
import { SwipeDirection } from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { D6RouteMenuProps } from '../screens/MapScreen/components/D6RouteMenu';
import { lightTap, selectionTick } from '../utils/haptics';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { D6RoutePane, type D6RoutePaneProps, type D6RouteSelection } from '../screens/MapScreen/components/D6RoutePane';
import type { Destination } from '../types';
import { D6RouteRow } from '../screens/MapScreen/components/D6RouteRow';
import { applyReorderUpdates } from '../screens/MapScreen/itineraryReorder';

jest.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceTransparencyEnabled: async () => false,
    addEventListener: () => ({ remove: jest.fn() }),
  },
  Modal: 'Modal',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: object) => styles, absoluteFill: {}, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@expo/ui/community/masked-view', () => ({ MaskedView: 'MaskedView' }));
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
      failOffsetY() { return this; },
      onStart(callback: (...args: unknown[]) => void) { this.callbacks.set('start', callback); return this; },
      onEnd(callback: (...args: unknown[]) => void) { this.callbacks.set('end', callback); return this; },
    }),
  },
}));
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: 'Swipeable',
  SwipeDirection: { LEFT: 'left', RIGHT: 'right' },
}));
jest.mock('../screens/MapScreen/components/D6RouteMenu', () => ({
  __esModule: true,
  default: (props: D6RouteMenuProps) => {
    const { Platform } = jest.requireMock<typeof import('react-native')>('react-native');
    const { createElement } = jest.requireActual<typeof import('react')>('react');
    const { default: Menu } = Platform.OS === 'ios'
      ? jest.requireActual<typeof import('../screens/MapScreen/components/D6RouteMenu.ios')>('../screens/MapScreen/components/D6RouteMenu.ios')
      : jest.requireActual<typeof import('../screens/MapScreen/components/D6RouteMenu')>('../screens/MapScreen/components/D6RouteMenu');
    return createElement(Menu, props);
  },
}));
jest.mock('@expo/ui/swift-ui', () => ({
  Host: 'SwiftUIHost', Menu: 'SwiftUIMenu', Image: 'SwiftUIImage', Button: 'SwiftUIButton',
}));
jest.mock('@expo/ui/swift-ui/modifiers', () => {
  const modifiers = [
    'accessibilityLabel', 'background', 'buttonStyle', 'contentShape', 'font', 'foregroundColor',
    'frame', 'glassEffect', 'menuIndicator', 'menuOrder', 'menuStyle', 'padding',
  ];
  return {
    ...Object.fromEntries(modifiers.map(name => [name, (...args: unknown[]) => ({ name, args })])),
    shapes: { circle: () => 'circle' },
  };
});
jest.mock('../native', () => ({ liquidGlass: { isLiquidGlassAvailable: () => true } }));
jest.mock('react-native-reanimated', () => {
  const { Component, createElement, forwardRef } = jest.requireActual<typeof import('react')>('react');
  type NativeProps = Record<string, unknown> & { forwardedRef: React.Ref<object> };
  class NativeAnimatedView extends Component<NativeProps> {
    setComponentRef = (view: object | null) => {
      const ref = this.props.forwardedRef;
      if (typeof ref === 'function') ref(view);
      else if (ref) ref.current = view;
    };
    render() {
      const { forwardedRef, ...props } = this.props;
      return createElement('AnimatedView', { ...props, ref: this.setComponentRef });
    }
  }
  const AnimatedView = forwardRef<object, Record<string, unknown>>((props, ref) =>
    createElement(NativeAnimatedView, { ...props, forwardedRef: ref }));
  return {
    __esModule: true,
    default: { View: AnimatedView },
    runOnJS: (callback: () => void) => callback,
    measure: jest.fn(() => null),
    useAnimatedRef: () => {
      const { useState } = jest.requireActual<typeof import('react')>('react');
      return useState(() => () => ({ attached: true }))[0];
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
  };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) }));
jest.mock('../components/SheetPresentation', () => 'NativeSheet');
jest.mock('../components/SwiftUIGlassSurface', () => ({ __esModule: true, default: 'SwiftUIGlassSurface' }));
jest.mock('../utils/haptics', () => ({ lightTap: jest.fn(), selectionTick: jest.fn() }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ language: 'zh', t: (key: string) => key }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stop = (id: string, day: number): Destination => ({
  id, title: id, day, order: 0, coordinates: { latitude: 25, longitude: 121 },
});

function mount(element: React.ReactElement) {
  return create(element, { createNodeMock: () => ({ scrollTo: () => undefined, measureInWindow: () => undefined }) });
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

  it('uses a native iOS More menu and presents the dates sheet only when selected', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const onManageArrivals = jest.fn();
    const onCompleteEarly = jest.fn();
    await act(async () => {
      renderer = mount(React.createElement(D6RoutePane, {
        ...props,
        onManageArrivals,
        onCompleteEarly,
        legacyContent: React.createElement('LegacyTools'),
      }));
    });
    const sheet = () => renderer.root.findByType('NativeSheet' as never);
    const menu = renderer.root.findByType('SwiftUIMenu' as never);
    expect(menu.props.testID).toBe('d6-route-options');
    expect(menu.props.label.props.systemName).toBe('ellipsis');
    expect(menu.props.modifiers).toContainEqual({ name: 'accessibilityLabel', args: ['更多'] });
    expect(menu.findAllByType('SwiftUIButton' as never).map(button => button.props.label)).toEqual([
      '選取', '日期', 'arrival.manage', '提前完成集合點', '其他行程工具', '匯入 KML',
    ]);
    expect(sheet().props.visible).toBe(false);
    await act(async () => byId('map-arrival-manage').props.onPress());
    await act(async () => byId('d6-route-complete-early').props.onPress());
    await act(async () => byId('d6-route-menu-kml').props.onPress());
    expect(onManageArrivals).toHaveBeenCalledTimes(1);
    expect(onCompleteEarly).toHaveBeenCalledTimes(1);
    expect(props.onImport).toHaveBeenCalledTimes(1);
    expect(sheet().props.visible).toBe(false);
    await act(async () => byId('d6-route-menu-dates').props.onPress());
    expect(sheet().props.visible).toBe(true);
    await act(async () => byId('d6-route-dates-done').props.onPress());
    expect(sheet().props.visible).toBe(false);
    await act(async () => sheet().props.onDismiss());
    await act(async () => byId('d6-route-menu-dates').props.onPress());
    expect(sheet().props.visible).toBe(true);
  });

  it('keeps the More options and date controls available on Android', async () => {
    await act(async () => { renderer = mount(React.createElement(Shell, { canEdit: true })); });
    await act(async () => byId('d6-route-options').props.onPress());
    expect(byId('d6-route-close-options').props.accessibilityLabel).toBe('common.close');
    await act(async () => byId('d6-route-menu-dates').props.onPress());
    expect(byId('d6-route-dates-done').props.accessibilityLabel).toBe('map.done');
    await act(async () => byId('d6-route-dates-done').props.onPress());
    await act(async () => byId('d6-route-options').props.onPress());
    await act(async () => byId('d6-route-menu-kml').props.onPress());
    expect(props.onImport).toHaveBeenCalledTimes(1);
    expect(byId('d6-route-close-options')).toBeUndefined();
  });

  it('scales actions out from the trailing edge and reverses them as the row closes', async () => {
    await act(async () => { renderer = mount(React.createElement(Shell, { canEdit: true })); });
    const swipe = () => renderer.root.findAllByType('Swipeable' as never)[0];
    const close = jest.fn();
    const methods = { close };
    let actions: ReactTestRenderer | undefined;

    const renderActions = async (offset: number) => {
      const position = { get: () => offset };
      await act(async () => {
        const element = swipe().props.renderRightActions(position, position, methods);
        if (actions) actions.update(element);
        else actions = mount(element);
      });
      const action = actions?.root.findByProps({ accessibilityLabel: '刪除 a' });
      return { style: action?.parent?.props.style, onPress: action?.props.onPress };
    };

    try {
      const dot = await renderActions(-8);
      const midway = await renderActions(-74);
      expect(dot.style.transform[1].scaleX).toBeLessThan(midway.style.transform[1].scaleX);
      expect(dot.style.transform[0].translateX).toBeGreaterThan(midway.style.transform[0].translateX);
      expect(actions?.root.props.interactive).toBe(false);

      await act(async () => swipe().props.onSwipeableOpen(SwipeDirection.LEFT));
      const button = await renderActions(-152);
      expect(button.style.transform).toEqual([{ translateX: 0 }, { scaleX: 1 }, { scaleY: 1 }]);
      expect(actions?.root.props.interactive).toBe(true);
      await act(async () => button.onPress());
      expect(close).toHaveBeenCalledTimes(1);
      await act(async () => { jest.advanceTimersByTime(220); });
      expect(onDelete).toHaveBeenCalledWith(['a']);

      await act(async () => { renderer.update(React.createElement(Shell, { canEdit: true })); });
      expect((await renderActions(-74)).style).toEqual(midway.style);
      expect((await renderActions(-8)).style).toEqual(dot.style);
      expect((await renderActions(0)).style.opacity).toBe(0);
    } finally {
      await act(async () => actions?.unmount());
    }
  });

  it('hides the grip through each swipe and taps once for a committed open or right-swipe close', async () => {
    await act(async () => { renderer = mount(React.createElement(Shell, { canEdit: true })); });
    const swipe = () => renderer.root.findAllByType('Swipeable' as never)[0];
    const grip = () => byId('d6-route-drag-a');

    expect(grip().props.accessible).toBe(true);
    await act(async () => swipe().props.onSwipeableOpenStartDrag(SwipeDirection.LEFT));
    expect(grip().props.accessibilityElementsHidden).toBe(true);
    expect(grip().props.pointerEvents).toBe('none');
    expect(lightTap).not.toHaveBeenCalled();
    await act(async () => swipe().props.onSwipeableWillClose(SwipeDirection.RIGHT));
    await act(async () => swipe().props.onSwipeableClose(SwipeDirection.RIGHT));
    expect(grip().props.accessible).toBe(true);
    expect(lightTap).not.toHaveBeenCalled();

    await act(async () => swipe().props.onSwipeableOpenStartDrag(SwipeDirection.LEFT));
    await act(async () => {
      swipe().props.onSwipeableWillOpen(SwipeDirection.LEFT);
      swipe().props.onSwipeableWillOpen(SwipeDirection.LEFT);
      swipe().props.onSwipeableOpen(SwipeDirection.LEFT);
    });
    expect(grip().props.accessibilityElementsHidden).toBe(true);
    expect(lightTap).toHaveBeenCalledTimes(1);
    await act(async () => {
      swipe().props.onSwipeableCloseStartDrag(SwipeDirection.RIGHT);
      swipe().props.onSwipeableWillClose(SwipeDirection.RIGHT);
      swipe().props.onSwipeableWillClose(SwipeDirection.RIGHT);
    });
    expect(grip().props.accessibilityElementsHidden).toBe(true);
    expect(lightTap).toHaveBeenCalledTimes(2);
    await act(async () => swipe().props.onSwipeableClose(SwipeDirection.RIGHT));
    expect(grip().props.accessible).toBe(true);
  });

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

  it.each(['same day', 'another day'])('accepts a second drag to %s after reordering in the same mounted pane', async target => {
    function EditableRoute() {
      const [destinations, setDestinations] = useState(() =>
        props.destinations.map((destination, order) => ({ ...destination, order })));
      return React.createElement(D6RoutePane, {
        ...props, destinations,
        onReorder: async updates => {
          const saved = await props.onReorder(updates);
          if (saved) setDestinations(current => applyReorderUpdates(current, updates, props.departureDate));
          return saved;
        },
      });
    }
    await act(async () => { renderer = mount(React.createElement(EditableRoute)); });
    const pane = renderer.root.findByType(D6RoutePane);
    const row = renderer.root.findAllByType(D6RouteRow)[0];
    const first = measuredDrag();
    act(() => first.get('start')({ absoluteX: 270, absoluteY: 95 }));
    await act(async () => first.get('end')({ absoluteX: 270, absoluteY: 170 }, true));
    expect(props.onReorder).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByType(D6RouteRow).map(row => row.props.row.id)).toEqual(['b', 'a']);
    expect(renderer.root.findByType(D6RoutePane)).toBe(pane);
    expect(renderer.root.findAllByType(D6RouteRow)[1]).toBe(row);

    for (const day of [1, 2]) {
      act(() => byId(`d6-route-day-${day}`).props.ref({
        measureInWindow: (deliver: (x: number, y: number, width: number, height: number) => void) =>
          deliver((day - 1) * 52, 0, 52, 64),
      }));
    }
    act(() => renderer.root.findByProps({ horizontal: true }).props.onLayout({ nativeEvent: { layout: { width: 300 } } }));
    const callbacks = measuredDrag();
    const owner = row.props.drag.owner;
    act(() => callbacks.get('start')({ absoluteX: 270, absoluteY: 150 }));
    expect(owner.get()).toBe('reorder');
    const point = target === 'same day' ? { absoluteX: 270, absoluteY: 80 } : { absoluteX: 78, absoluteY: 30 };
    await act(async () => callbacks.get('end')(point, true));
    expect(props.onReorder).toHaveBeenCalledTimes(2);
    expect(props.onReorder).toHaveBeenLastCalledWith(expect.arrayContaining([
      { id: 'a', day: target === 'same day' ? 1 : 2, position: target === 'same day' ? 0 : 2 },
    ]));
  });

  it('keeps the mounted gesture and active session while publishing a same-scope callback update', async () => {
    await act(async () => { renderer = mount(React.createElement(D6RoutePane, props)); });
    const gesture = byId('d6-route-drag-a').parent?.props.gesture;
    const paneRef = byId('d6-route-pane').props.ref;
    const callbacks = measuredDrag();
    const row = renderer.root.findAllByType(D6RouteRow)[0];
    const owner = row.props.drag.owner;
    const rowRef = byId('d6-route-drag-a').props.ref;
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
    const rowRef = byId('d6-route-drag-a').props.ref;
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

  it('ticks for each day crossed while swiping the date strip and selects the centered day when it settles', async () => {
    const onSelectDay = jest.fn();
    await act(async () => { renderer = mount(React.createElement(D6RoutePane, { ...props, tripDays: 4, onSelectDay })); });
    jest.mocked(selectionTick).mockClear();
    const strip = () => renderer.root.findAll(node => node.type === 'ScrollView' && node.props.horizontal)[0].props;
    const at = (x: number, velocity = 0) => ({ nativeEvent: { contentOffset: { x }, velocity: { x: velocity }, contentSize: { width: 400 }, layoutMeasurement: { width: 200 } } });
    act(() => strip().onScrollBeginDrag());
    act(() => strip().onScroll(at(30)));
    act(() => strip().onScroll(at(110)));
    expect(selectionTick).toHaveBeenCalledTimes(2);
    expect(onSelectDay).not.toHaveBeenCalled();
    act(() => strip().onScrollEndDrag(at(110, 1)));
    act(() => strip().onMomentumScrollEnd(at(400)));
    expect(selectionTick).toHaveBeenCalledTimes(3);
    expect(onSelectDay.mock.calls).toEqual([[4]]);
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
