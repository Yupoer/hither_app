import React from 'react';
const mockListeners = new Set<(state: string) => void>();
const mockAppState = { currentState: 'active', addEventListener: (_: string, listener: (state: string) => void) => {
  mockListeners.add(listener); return { remove: () => mockListeners.delete(listener) };
} };
const mockCamera = { center: { latitude: 25, longitude: 121 }, pitch: 30, heading: 12, zoom: 16, altitude: 800 };
const mockSurface = { getCamera: jest.fn(async () => mockCamera), animateToRegion: jest.fn(),
  setCamera: jest.fn(), animateCamera: jest.fn(), fitToCoordinates: jest.fn() };
const mockColors = new Proxy({}, { get: (_, key) => key === 'accent' ? '#ff0000' : '#ffffff' });
jest.mock('react-native', () => ({ AppState: mockAppState, Platform: { OS: 'ios' },
  StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 390, height: 844 }), View: 'View', Text: 'Text', Pressable: 'Pressable',
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
}));
jest.mock('react-native-maps', () => ({ __esModule: true,
  default: require('react').forwardRef((props: any, ref: any) => {
    require('react').useImperativeHandle(ref, () => mockSurface);
    return require('react').createElement('NativeMap', props, props.children);
  }), Marker: 'Marker', Polyline: 'Polyline',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../state/PreferencesContext', () => ({ usePreferences: () => ({ dayColors: {} }),
  useTheme: () => ({ colors: mockColors, themeName: 'day' }) }));
jest.mock('../components/HitherText', () => ({ HitherText: 'Text' }));
jest.mock('../i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../utils/activityLog', () => ({ logError: jest.fn(), logEvent: jest.fn() }));
jest.mock('../native/maps', () => ({ platformizedMapLifecycle: () => () => {}, platformizedMapViewProps: () => ({}) }));
jest.mock('../native/mapTransitDefaults', () => ({ defaultMapTransitProps: () => ({}) }));
jest.mock('../utils/routeLod', () => {
  const real = jest.requireActual('../utils/routeLod');
  return { ...real, displayRoutePoints: jest.fn(real.displayRoutePoints) };
});
jest.mock('../utils/advanceRouteToCoordinate', () => {
  const real = jest.requireActual('../utils/advanceRouteToCoordinate');
  return { ...real, advanceRouteToCoordinate: jest.fn(real.advanceRouteToCoordinate) };
});
import GroupMap, { type GroupMapCameraState } from '../components/GroupMap';
import { displayRoutePoints } from '../utils/routeLod';
import { advanceRouteToCoordinate } from '../utils/advanceRouteToCoordinate';
import { energyObservability } from '../state/energyObservability';
const { act, create } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
function transition(state: string) {
  mockAppState.currentState = state;
  for (const listener of mockListeners) listener(state);
}

it('releases the actual map subtree, stops route projection during background updates and restores the settled camera', async () => {
  const route = Array.from({ length: 2000 }, (_, i) => ({ latitude: 25 + i * 0.00001, longitude: 121 + i * 0.00001 }));
  const cameraState: { current: GroupMapCameraState } = { current: {} };
  const draw = (points: typeof route, active = true) => React.createElement(GroupMap, {
    members: [], routePoints: points, selfCoordinates: route[0], cameraState, active,
  });
  let root: any;
  await act(async () => { root = create(draw(route)); });
  expect(root.root.findAllByType('NativeMap')).toHaveLength(1);
  const region = { latitude: 25.02, longitude: 121.02, latitudeDelta: 0.01, longitudeDelta: 0.015 };
  await act(async () => { root.root.findByType('NativeMap').props.onRegionChangeComplete(region); });
  expect(cameraState.current.camera).toEqual(mockCamera);
  const projected = (displayRoutePoints as jest.Mock).mock.calls.length;
  const advanced = (advanceRouteToCoordinate as jest.Mock).mock.calls.length;
  for (let cycle = 0; cycle < 30; cycle++) {
    await act(async () => { transition('inactive'); transition('background'); });
    expect(root.root.findAllByType('NativeMap')).toHaveLength(0);
    expect(energyObservability.workloadSnapshot().mapCount).toBe(0);
    const beforeProjection = (displayRoutePoints as jest.Mock).mock.calls.length;
    const beforeAdvance = (advanceRouteToCoordinate as jest.Mock).mock.calls.length;
    for (let i = 0; i < 10; i++) await act(async () => { root.update(draw([...route])); });
    expect((displayRoutePoints as jest.Mock).mock.calls.length).toBe(beforeProjection);
    expect((advanceRouteToCoordinate as jest.Mock).mock.calls.length).toBe(beforeAdvance);
    await act(async () => { transition('active'); transition('active'); });
    const map = root.root.findByType('NativeMap');
    expect(map.props.initialCamera).toEqual(mockCamera);
    expect(map.props.initialRegion).toEqual(region);
  }
  expect((displayRoutePoints as jest.Mock).mock.calls.length - projected).toBe(30);
  expect((advanceRouteToCoordinate as jest.Mock).mock.calls.length - advanced).toBe(30);
  expect(mockSurface.animateToRegion).not.toHaveBeenCalled();
  await act(async () => { root.update(draw(route, false)); });
  expect(root.root.findAllByType('NativeMap')).toHaveLength(0);
  await act(async () => { root.unmount(); });
  expect(mockListeners.size).toBe(0);
});
