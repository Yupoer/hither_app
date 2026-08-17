type PlatformName = 'ios' | 'android' | 'web';

type MapsBoundary = typeof import('../native/maps');

const chrome = {
  compassOffset: { x: 72, y: 148 },
  appleLogoInsets: { top: 0, right: 0, left: 20, bottom: 46 },
};

function loadBoundary(platform: PlatformName): MapsBoundary {
  jest.resetModules();
  jest.doMock('react-native', () => ({ Platform: { OS: platform } }));
  jest.doMock('expo-modules-core', () => ({
    requireOptionalNativeModule: jest.fn(() => null),
  }));
  jest.doMock('../native/googleMapsProxy', () => ({
    MapsProxyError: class MapsProxyError extends Error {
      code = 'network';
      status = 0;
    },
    proxyGetDirections: jest.fn(),
    proxySearchPlaces: jest.fn(),
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return {
    ...require('../native/maps'),
    ...require('../native/mapTransitDefaults'),
  } as MapsBoundary;
}

afterEach(() => {
  jest.resetModules();
  jest.dontMock('react-native');
  jest.dontMock('expo-modules-core');
  jest.dontMock('../native/googleMapsProxy');
});

describe('platformized MapView boundary', () => {
  it('provides MapKit chrome and location ownership on iOS only', () => {
    const maps = loadBoundary('ios');
    const ready = jest.fn();
    const androidReady = jest.fn();
    const loaded = jest.fn();
    const location = jest.fn();
    const props = {
      ...maps.platformizedMapViewProps({
        chrome,
        onMapReady: ready,
        onAndroidMapReady: androidReady,
        onAndroidMapLoaded: loaded,
        onUserLocationSample: location,
      }),
      ...maps.defaultMapTransitProps(),
    };

    expect(props.provider).toBeUndefined();
    expect(props.showsPointsOfInterests).toBe(true);
    expect(props.pointsOfInterestFilter).toEqual([
      'publicTransport',
      'airport',
      'parking',
      'marina',
    ]);
    expect(props.showsTransit).toBeUndefined();
    expect(props.compassOffset).toEqual(chrome.compassOffset);
    expect(props.appleLogoInsets).toEqual(chrome.appleLogoInsets);
    expect(props.onMapLoaded).toBeUndefined();

    props.onMapReady?.();
    props.onUserLocationChange?.({
      nativeEvent: {
        coordinate: { latitude: 25, longitude: 121, accuracy: 4, timestamp: 123 },
      },
    });
    expect(ready).toHaveBeenCalledTimes(1);
    expect(androidReady).not.toHaveBeenCalled();
    expect(loaded).not.toHaveBeenCalled();
    expect(location).toHaveBeenCalledWith({
      coordinates: { latitude: 25, longitude: 121 },
      accuracy: 4,
      timestamp: 123,
    });
  });

  it('provides Google transit and Android lifecycle callbacks without iOS chrome', () => {
    const maps = loadBoundary('android');
    const ready = jest.fn();
    const androidReady = jest.fn();
    const loaded = jest.fn();
    const location = jest.fn();
    const props = maps.platformizedMapViewProps({
      chrome,
      onMapReady: ready,
      onAndroidMapReady: androidReady,
      onAndroidMapLoaded: loaded,
      onUserLocationSample: location,
    });

    expect(props.provider).toBe('google');
    expect(props.showsTransit).toBe(true);
    expect(props.showsPointsOfInterests).toBeUndefined();
    expect(props.compassOffset).toBeUndefined();
    expect(props.appleLogoInsets).toBeUndefined();
    expect(props.onUserLocationChange).toBeUndefined();

    props.onMapReady?.();
    props.onMapLoaded?.();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(androidReady).toHaveBeenCalledTimes(1);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(location).not.toHaveBeenCalled();
  });

  it('fails closed to generic map props on unsupported runtimes', () => {
    const maps = loadBoundary('web');
    const ready = jest.fn();
    const location = jest.fn();
    const props = maps.platformizedMapViewProps({
      chrome,
      onMapReady: ready,
      onUserLocationSample: location,
    });

    expect(props.provider).toBeUndefined();
    expect(props.showsTransit).toBeUndefined();
    expect(props.showsPointsOfInterests).toBeUndefined();
    expect(props.compassOffset).toBeUndefined();
    expect(props.appleLogoInsets).toBeUndefined();
    expect(props.onUserLocationChange).toBeUndefined();
    props.onMapReady?.();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(location).not.toHaveBeenCalled();
  });
});
