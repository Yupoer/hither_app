import React from 'react';
import { act, create } from 'react-test-renderer';
import MapView, { Marker } from 'react-native-maps';
import GroupMap from '../components/GroupMap';
import { energyObservability } from '../state/energyObservability';
import type { Destination } from '../types';
import { TARGET_PULSE_INTERVAL_MS } from '../utils/targetMarkerPulse';
import { logError, logEvent } from '../utils/activityLog';

const mockMotionListeners = new Set<(reduced: boolean) => void>();
const mockSurface = { animateToRegion: jest.fn(), animateCamera: jest.fn(), fitToCoordinates: jest.fn(), getCamera: async () => ({}) };
const mockColors = new Proxy({}, { get: (_, key) => key === 'accent' ? '#f00' : '#fff' });
const mockAnimationStarts = jest.fn();
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { absoluteFill: {}, create: (s: unknown) => s },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: (_: string, fn: (reduced: boolean) => void) => {
    mockMotionListeners.add(fn); return { remove: () => mockMotionListeners.delete(fn) };
  } },
  Animated: { View: 'AnimatedView', Value: class {
    value: number;
    constructor(value: number) { this.value = value; }
    setValue(value: number) { this.value = value; }
    stopAnimation = jest.fn();
  }, timing: () => ({}), sequence: () => ({ start: mockAnimationStarts }) },
}));
jest.mock('react-native-maps', () => ({ __esModule: true,
  default: require('react').forwardRef((props: { children?: React.ReactNode }, ref: React.Ref<unknown>) => {
    require('react').useImperativeHandle(ref, () => mockSurface);
    return require('react').createElement('NativeMap', props, props.children);
  }), Marker: 'Marker', Polyline: 'Polyline',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('../components/useMemberMarkerMotion', () => ({ useMemberMarkerMotion: (_: unknown, sample: { coordinates: unknown }) => sample.coordinates }));
jest.mock('../state/foregroundUi', () => ({ useForegroundUi: () => true, useVisibleUi: () => true, isVisibleUi: () => true }));
const mockPower = {};
jest.mock('../state/runtimePowerState', () => ({ getRuntimePowerState: () => mockPower, subscribeRuntimePowerState: () => () => {}, optionalVisualsAllowed: () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../state/PreferencesContext', () => ({ useTheme: () => ({ colors: mockColors, themeName: 'day' }), usePreferences: () => ({ dayColors: {} }) }));
jest.mock('../components/HitherText', () => ({ HitherText: 'Text' }));
jest.mock('../utils/activityLog', () => ({ logError: jest.fn(), logEvent: jest.fn() }));
jest.mock('../native/maps', () => ({
  platformizedMapLifecycle: ({ onAndroidMapMount, onAndroidMapUnmount }: { onAndroidMapMount: () => void; onAndroidMapUnmount: () => void }) => {
    onAndroidMapMount(); return onAndroidMapUnmount;
  },
  platformizedMapViewProps: (callbacks: { onAndroidMapReady: () => void; onAndroidMapLoaded: () => void }) => ({
    onMapReady: callbacks.onAndroidMapReady, onMapLoaded: callbacks.onAndroidMapLoaded,
  }),
}));
jest.mock('../native/mapTransitDefaults', () => ({ defaultMapTransitProps: () => ({}) }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('captures each marker bitmap for a finite window without remounting native markers or merging identity inputs', async () => {
  jest.useFakeTimers();
  const event = jest.spyOn(energyObservability, 'event');
  let destination: Destination = { id: 'd1', title: 'Point', order: 0, day: 1, coordinates: { latitude: 25, longitude: 121 } };
  const member = { userId: 'm1', name: 'Member', role: 'leader' as const, status: 'active' as const, coordinates: { latitude: 25, longitude: 121 } };
  const draw = () => React.createElement(GroupMap, { destinations: [destination], members: [member], pendingPlace: { name: 'Pending', coordinates: member.coordinates } });
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(draw()); });
  const marker = () => tree.root.findAllByType(Marker).find(node => node.props.title === destination.title)!;
  const nativeOwner = marker();
  expect(tree.root.findAllByType(Marker)).toHaveLength(3);
  expect(tree.root.findAllByType(Marker).every(node => node.props.tracksViewChanges)).toBe(true);
  await act(async () => jest.advanceTimersByTime(500));
  expect(tree.root.findAllByType(Marker).every(node => !node.props.tracksViewChanges)).toBe(true);
  destination = { ...destination };
  await act(async () => tree.update(draw()));
  expect(marker().props.tracksViewChanges).toBe(false);
  const eventsBefore = event.mock.calls.filter(args => args[0] === 'marker_tracking').length;
  destination = { ...destination, title: 'New point' };
  await act(async () => tree.update(draw()));
  expect(marker()).toBe(nativeOwner);
  expect(marker().props.tracksViewChanges).toBe(true);
  expect(event.mock.calls.filter(args => args[0] === 'marker_tracking')).toHaveLength(eventsBefore);
  await act(async () => jest.advanceTimersByTime(250));
  destination = { ...destination, title: 'Newest point', emoji: 'star' };
  await act(async () => tree.update(draw()));
  await act(async () => jest.advanceTimersByTime(300));
  expect(marker().props.tracksViewChanges).toBe(true);
  expect(event.mock.calls.filter(args => args[0] === 'marker_tracking')).toHaveLength(eventsBefore + 1);
  await act(async () => jest.advanceTimersByTime(200));
  expect(marker().props.tracksViewChanges).toBe(false);
  await act(async () => tree.unmount());
  expect(mockMotionListeners.size).toBe(0);
  expect(energyObservability.workloadSnapshot().mapCount).toBe(0);
  event.mockRestore(); jest.useRealTimers();
});

it('retains native pulse values while replacing and cancelling the interval for reduced motion', async () => {
  jest.useFakeTimers(); mockAnimationStarts.mockClear();
  const destination: Destination = { id: 'd1', title: 'Target', order: 0, day: 1, coordinates: { latitude: 25, longitude: 121 } };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(GroupMap, { members: [], destinations: [destination], activeDestinationId: 'd1' })); });
  const marker = tree.root.findByType(Marker);
  expect(mockAnimationStarts).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(TARGET_PULSE_INTERVAL_MS));
  expect(mockAnimationStarts).toHaveBeenCalledTimes(2);
  await act(async () => { for (const listener of mockMotionListeners) listener(true); });
  expect(tree.root.findByType(Marker)).toBe(marker);
  await act(async () => jest.advanceTimersByTime(10_000));
  expect(mockAnimationStarts).toHaveBeenCalledTimes(2);
  await act(async () => { for (const listener of mockMotionListeners) listener(false); });
  expect(mockAnimationStarts).toHaveBeenCalledTimes(3);
  await act(async () => tree.unmount());
  await act(async () => jest.advanceTimersByTime(10_000));
  expect(mockAnimationStarts).toHaveBeenCalledTimes(3);
  jest.useRealTimers();
});

it('cancels Android readiness deadlines on background/unmount and keeps initial-camera ownership across new equal objects', async () => {
  jest.useFakeTimers(); jest.clearAllMocks();
  const center = { latitude: 25, longitude: 121 };
  const base = { members: [], initialCenter: center };
  const draw = (active = true, initialCenter = center, gathering?: Destination) => React.createElement(GroupMap, { ...base, active, initialCenter, gathering });
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(draw()); });
  const map = () => tree.root.findByType(MapView);
  const nativeOwner = map();
  expect(mockSurface.animateToRegion).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(React.createElement(GroupMap, { ...base, topOverlap: 250, bottomOverlap: 300, chromeStage: 'stage2' })));
  expect(map()).toBe(nativeOwner);
  expect(mockSurface.animateToRegion).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(draw(true, { ...center })));
  expect(map()).toBe(nativeOwner);
  expect(mockSurface.animateToRegion).toHaveBeenCalledTimes(1);
  const destination: Destination = { id: 'gathering', title: 'Gather', day: 1, order: 0, coordinates: center };
  await act(async () => tree.update(draw(true, center, destination)));
  expect(mockSurface.animateToRegion).toHaveBeenCalledTimes(2);
  await act(async () => tree.update(draw(true, center, { ...destination })));
  expect(mockSurface.animateToRegion).toHaveBeenCalledTimes(2);
  await act(async () => map().props.onMapReady());
  await act(async () => tree.update(draw(false)));
  await act(async () => jest.advanceTimersByTime(10_000));
  expect((logError as jest.Mock).mock.calls.filter(args => args[0] === 'map_loaded_timeout')).toHaveLength(0);
  expect((logEvent as jest.Mock).mock.calls.filter(args => args[0] === 'android_map_unmount')).toHaveLength(1);
  await act(async () => tree.update(draw()));
  await act(async () => { map().props.onMapReady(); map().props.onMapLoaded(); });
  await act(async () => jest.advanceTimersByTime(10_000));
  expect((logError as jest.Mock).mock.calls.filter(args => args[0] === 'map_loaded_timeout')).toHaveLength(0);
  await act(async () => tree.update(draw(false)));
  await act(async () => tree.update(draw()));
  await act(async () => map().props.onMapReady());
  await act(async () => tree.unmount());
  await act(async () => jest.advanceTimersByTime(10_000));
  expect((logError as jest.Mock).mock.calls.filter(args => args[0] === 'map_loaded_timeout')).toHaveLength(0);
  expect((logEvent as jest.Mock).mock.calls.filter(args => args[0] === 'android_map_mount')).toHaveLength(3);
  expect((logEvent as jest.Mock).mock.calls.filter(args => args[0] === 'android_map_unmount')).toHaveLength(3);
  jest.useRealTimers();
});
