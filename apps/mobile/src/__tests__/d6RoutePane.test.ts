import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { D6RoutePane, type D6RoutePaneProps, type D6RouteSelection } from '../screens/MapScreen/components/D6RoutePane';
import type { Destination } from '../types';

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
      hitSlop() { return this; },
      activeOffsetX() { return this; },
      onStart() { return this; },
      onEnd() { return this; },
    }),
  },
}));
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({ __esModule: true, default: 'Swipeable' }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  runOnJS: (callback: () => void) => callback,
  useAnimatedStyle: (style: () => object) => style(),
  useSharedValue: (initial: number) => {
    let value = initial;
    return { get: () => value, set: (next: number) => { value = next; } };
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
    jest.useFakeTimers();
    globalThis.requestAnimationFrame = (fn) => Number(setTimeout(() => fn(0), 0));
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('keeps the island selection in sync through parent rerenders and day changes', async () => {
    await act(async () => { renderer = create(React.createElement(Shell, { canEdit: true })); });
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
    await act(async () => { renderer = create(React.createElement(Shell, { canEdit: false })); });
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
    await act(async () => { renderer = create(React.createElement(D6RoutePane, {
      ...props, destinations, dailyAccommodations: [{ id: 'daily-bed', groupId: 'g', stayDate: '2026-11-01',
        title: 'Hotel', coordinates: { latitude: 25, longitude: 121 } }],
    })); });
    const section = byId('d6-accommodation-section');
    expect(section.findAllByProps({ testID: 'd6-route-row-old-bed' })).not.toHaveLength(0);
    expect(section.findAllByProps({ testID: 'd6-route-row-daily-bed' })).not.toHaveLength(0);
    expect(section.findAllByProps({ testID: 'd6-route-row-a' })).toHaveLength(0);
    expect(byId('d6-route-drag-old-bed')).toBeUndefined();
    act(() => byId('d6-route-drag-a').props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(props.onReorder).toHaveBeenCalledWith([
      { id: 'old-bed', day: 1, position: 0 }, { id: 'b', day: 1, position: 1 }, { id: 'a', day: 1, position: 2 },
    ]);
  });
});
