const mockPlatform = { OS: 'ios' as 'ios' | 'android' | 'web' };
const mockNativeMaps = {
  searchPlaces: jest.fn(),
  getDirections: jest.fn(),
};
const mockNativeMetrics = {
  drainPayloads: jest.fn(),
  removePayloads: jest.fn(),
  samplePerformance: jest.fn(),
  setCollectionEnabled: jest.fn(),
  purgePayloads: jest.fn(),
  previousLaunch: jest.fn(),
  markLaunchPhase: jest.fn(),
  signpost: jest.fn(),
};
const mockProxySearch = jest.fn();
const mockProxyDirections = jest.fn();
const mockEnergy = {
  increment: jest.fn(),
  beginSpan: jest.fn(() => 'route-span'),
  endSpan: jest.fn(),
};

jest.mock('react-native', () => ({ Platform: mockPlatform }));
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) =>
    name === 'HitherMaps' ? mockNativeMaps : name === 'HitherMetrics' ? mockNativeMetrics : null,
}));
jest.mock('../native/googleMapsProxy', () => ({
  MapsProxyError: class MapsProxyError extends Error {
    code: string;
    status: number;
    constructor(code: string, status: number) {
      super(code);
      this.name = 'MapsProxyError';
      this.code = code;
      this.status = status;
    }
  },
  proxySearchPlaces: (...args: unknown[]) => mockProxySearch(...args),
  proxyGetDirections: (...args: unknown[]) => mockProxyDirections(...args),
}));
jest.mock('../state/energyObservability', () => ({ energyObservability: mockEnergy }));

import {
  defaultMapTransitProps,
  getDirections,
  handlePlatformizedUserLocationChange,
  matchesPlaceQuery,
  platformizedMapLifecycle,
  platformizedMapViewProps,
  searchPlaces,
} from '../native/maps';
import {
  drainPayloads,
  markLaunchPhase,
  previousLaunch,
  purgePayloads,
  removePayloads,
  samplePerformance,
  setCollectionEnabled,
  signpost,
} from '../native/metrics';

const from = { latitude: 25.033, longitude: 121.5654 };
const to = { latitude: 25.0478, longitude: 121.517 };
const place = {
  id: 'place-1',
  name: 'Coffee Shop',
  address: 'Taipei Main Station',
  coordinates: to,
};

function response(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe('native maps boundary behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.OS = 'ios';
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    mockNativeMaps.searchPlaces.mockResolvedValue([]);
    mockNativeMaps.getDirections.mockResolvedValue(null);
    mockProxySearch.mockResolvedValue(null);
    mockProxyDirections.mockResolvedValue(null);
    mockEnergy.beginSpan.mockReturnValue('route-span');
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes matching, invalid, and valid MapKit location events', () => {
    expect(matchesPlaceQuery(place, ' coffee   station ')).toBe(true);
    expect(matchesPlaceQuery(place, 'Coffee Airport')).toBe(false);
    const onSample = jest.fn();
    handlePlatformizedUserLocationChange({ nativeEvent: {} }, onSample);
    handlePlatformizedUserLocationChange({ nativeEvent: { coordinate: { latitude: Number.NaN, longitude: 121 } } }, onSample);
    handlePlatformizedUserLocationChange({ nativeEvent: { coordinate: { latitude: 25, longitude: 121 } } }, onSample);
    expect(mockEnergy.increment).toHaveBeenCalledTimes(3);
    expect(onSample).toHaveBeenLastCalledWith({
      coordinates: { latitude: 25, longitude: 121 },
      accuracy: null,
      timestamp: 1_000,
    });
    mockPlatform.OS = 'android';
    handlePlatformizedUserLocationChange({ nativeEvent: { coordinate: { latitude: 25, longitude: 121 } } }, onSample);
    expect(onSample).toHaveBeenCalledTimes(1);
  });

  it('builds platform props and balances Android lifecycle callbacks', () => {
    mockPlatform.OS = 'ios';
    expect(defaultMapTransitProps()).toEqual({ showsPointsOfInterests: true, showsBuildings: false });
    const onReady = jest.fn();
    const onAndroidReady = jest.fn();
    const onLoaded = jest.fn();
    const props = platformizedMapViewProps({
      headingEnabled: true,
      chrome: {
        compassOffset: { x: 1, y: 2 },
        appleLogoInsets: { top: 3, right: 4, bottom: 5, left: 6 },
      },
      onMapReady: onReady,
      onAndroidMapReady: onAndroidReady,
      onUserLocationSample: jest.fn(),
    });
    expect(props.showsUserHeadingIndicator).toBe(true);
    expect(props.onUserLocationChange).toEqual(expect.any(Function));
    props.onMapReady?.();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onAndroidReady).not.toHaveBeenCalled();

    mockPlatform.OS = 'android';
    expect(defaultMapTransitProps()).toEqual({ showsTransit: true });
    const androidReady = jest.fn();
    const androidLoaded = jest.fn();
    const mount = jest.fn();
    const unmount = jest.fn();
    const androidProps = platformizedMapViewProps({
      onMapReady: onReady,
      onAndroidMapReady: androidReady,
      onAndroidMapLoaded: androidLoaded,
    });
    androidProps.onMapReady?.();
    androidProps.onMapLoaded?.();
    const stop = platformizedMapLifecycle({ onAndroidMapMount: mount, onAndroidMapUnmount: unmount });
    stop();
    expect(androidReady).toHaveBeenCalledTimes(1);
    expect(androidLoaded).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(unmount).toHaveBeenCalledTimes(1);
    mockPlatform.OS = 'web';
    expect(defaultMapTransitProps()).toEqual({});
    expect(platformizedMapLifecycle({ onAndroidMapMount: mount })).not.toThrow();
  });

  it('searches coordinates, Plus Codes, native results, and fallback geocoders', async () => {
    await expect(searchPlaces('   ')).resolves.toEqual([]);
    await expect(searchPlaces('25.0683, 121.5971')).resolves.toEqual([{
      id: 'coordinates:25.0683,121.5971',
      name: '25.0683, 121.5971',
      coordinates: { latitude: 25.0683, longitude: 121.5971 },
    }]);

    mockProxySearch.mockRejectedValueOnce(new Error('offline'));
    await expect(searchPlaces('849VCWC8+Q48')).resolves.toEqual([expect.objectContaining({
      id: 'plus-code:849VCWC8+Q48',
    })]);

    mockProxySearch.mockResolvedValueOnce([{ ...place, providerPlaceId: 'google:nearby-poi' }]);
    const decodedTarget = await searchPlaces('849VCWC8+Q48');
    expect(decodedTarget[0].providerPlaceId).toBeUndefined();
    expect(decodedTarget[0].id).toBe('plus-code:849VCWC8+Q48');

    mockProxySearch.mockClear();
    mockNativeMaps.searchPlaces.mockResolvedValueOnce([place]);
    await expect(searchPlaces('coffee station')).resolves.toEqual([place]);
    expect(mockProxySearch).not.toHaveBeenCalled();

    mockNativeMaps.searchPlaces.mockRejectedValueOnce(new Error('MapKit failed'));
    mockProxySearch.mockResolvedValueOnce(null);
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response(200, {
        features: [
          { properties: { name: 'far' }, geometry: { coordinates: [121.58, 25.05] } },
          { properties: { osm_id: 7, osm_type: 'N', street: 'Road', city: 'Taipei' }, geometry: { coordinates: [121.517, 25.0478] } },
          { properties: {}, geometry: undefined },
        ],
      }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(searchPlaces('coffee', {
      latitude: 25.0478,
      longitude: 121.517,
      latitudeDelta: 0.2,
      longitudeDelta: 0.2,
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'N7', name: 'Road' }),
    ]));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    mockNativeMaps.searchPlaces.mockResolvedValueOnce([]);
    mockProxySearch.mockResolvedValueOnce(null);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(response(200, [{ place_id: 11, display_name: 'Taipei, Taiwan', lat: '25.04', lon: '121.51' }]));
    await expect(searchPlaces('台北', {
      latitude: 25,
      longitude: 121,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    })).resolves.toEqual([expect.objectContaining({ id: '11', name: 'Taipei' })]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails closed for Android production proxy errors and returns safe total failure', async () => {
    mockPlatform.OS = 'android';
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    const ProxyError = (jest.requireMock('../native/googleMapsProxy') as {
      MapsProxyError: new (code: string, status: number) => Error;
    }).MapsProxyError;
    mockProxySearch.mockRejectedValueOnce(new ProxyError('unauthorized', 401));
    await expect(searchPlaces('unknown place')).resolves.toEqual([]);

    mockNativeMaps.searchPlaces.mockRejectedValueOnce(new Error('timeout'));
    mockProxySearch.mockRejectedValueOnce(new Error('network'));
    await expect(searchPlaces('unknown place', undefined, { throwOnError: true })).rejects.toThrow('network');
  });

  it('uses native and proxy directions with a balanced energy span', async () => {
    const nativeRoute = { distanceMeters: 100, expectedTravelTimeSeconds: 20, points: [from, to] };
    mockNativeMaps.getDirections.mockResolvedValueOnce(nativeRoute);
    await expect(getDirections(from, to, 'walk')).resolves.toEqual({
      ...nativeRoute,
      points: [from, to],
      source: 'native',
    });
    expect(mockEnergy.increment).toHaveBeenCalledWith('route_recalc');
    expect(mockEnergy.beginSpan).toHaveBeenCalledWith('route_calculation');
    expect(mockEnergy.endSpan).toHaveBeenCalledWith('route_calculation', 'route-span');

    mockNativeMaps.getDirections.mockResolvedValueOnce({ ...nativeRoute, points: [] });
    const proxyRoute = { distanceMeters: 300, expectedTravelTimeSeconds: 60, points: [from, to], source: 'google' as const };
    mockProxyDirections.mockResolvedValueOnce(proxyRoute);
    await expect(getDirections(from, to, 'drive')).resolves.toEqual(proxyRoute);

    mockNativeMaps.getDirections.mockRejectedValueOnce(new Error('no native route'));
    mockProxyDirections.mockRejectedValueOnce(new Error('breaker'));
    await expect(getDirections(from, to, 'transit')).resolves.toBeNull();
    expect(mockNativeMaps.getDirections).toHaveBeenCalledTimes(2);
    expect(mockProxyDirections).toHaveBeenCalledTimes(2);
  });
});

describe('native metrics bridge', () => {
  beforeEach(() => jest.clearAllMocks());

  it('forwards every optional native metrics operation and updates power state', async () => {
    const payload = [{ id: 'm-1', kind: 'metric' as const, json: '{}', receivedAt: 10 }];
    const previous = { phase: 'stable', build: '42', recordedAt: 10 };
    mockNativeMetrics.drainPayloads.mockResolvedValue(payload);
    mockNativeMetrics.samplePerformance.mockResolvedValue({
      cpuPercent: 3,
      cpuTimeMs: 30,
      memoryMb: 10,
      uiFps: 60,
      frameTimeP95Ms: 16,
      missedFrameRatio: 0,
      displayMaxFps: 60,
      batteryLevel: 0.8,
      batteryState: 'charging',
      lowPowerMode: true,
      thermalState: 'nominal',
      appState: 'active',
      deviceModel: 'test',
      osVersion: '1',
    });
    mockNativeMetrics.setCollectionEnabled.mockResolvedValue(true);
    mockNativeMetrics.previousLaunch.mockResolvedValue(previous);

    await expect(drainPayloads()).resolves.toEqual(payload);
    await removePayloads([]);
    await removePayloads(['m-1']);
    await expect(samplePerformance(1_000)).resolves.toMatchObject({ lowPowerMode: true });
    await expect(setCollectionEnabled(true)).resolves.toBe(true);
    await purgePayloads();
    await expect(previousLaunch()).resolves.toEqual(previous);
    await markLaunchPhase('stable');
    await signpost('launch', 'event', 'token');

    expect(mockNativeMetrics.removePayloads).toHaveBeenCalledWith(['m-1']);
    expect(mockNativeMetrics.samplePerformance).toHaveBeenCalledWith(1_000);
    expect(mockNativeMetrics.purgePayloads).toHaveBeenCalledTimes(1);
    expect(mockNativeMetrics.markLaunchPhase).toHaveBeenCalledWith('stable');
    expect(mockNativeMetrics.signpost).toHaveBeenCalledWith('launch', 'event', 'token');
  });
});
