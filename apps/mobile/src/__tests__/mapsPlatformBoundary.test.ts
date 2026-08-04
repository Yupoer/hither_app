const platform = { OS: 'ios' as 'ios' | 'android' | 'web' };

jest.mock('react-native', () => ({ Platform: platform }));
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: jest.fn(() => null) }));
jest.mock('../native/googleMapsProxy', () => ({
  MapsProxyError: class MapsProxyError extends Error {},
  proxySearchPlaces: jest.fn(),
  proxyGetDirections: jest.fn(),
}));
jest.mock('../state/energyObservability', () => ({
  energyObservability: { increment: jest.fn(), beginSpan: jest.fn(), endSpan: jest.fn() },
}));

import { platformizedMapViewProps } from '../native/maps';

const chrome = {
  compassOffset: { x: 72, y: 88 },
  appleLogoInsets: { top: 0, right: 0, bottom: 24, left: 16 },
};

describe('platformized MapView boundary', () => {
  afterEach(() => {
    platform.OS = 'ios';
  });

  it('returns MapKit chrome and location callback only on iOS', () => {
    platform.OS = 'ios';
    const onSample = jest.fn();
    const onReady = jest.fn();
    const onAndroidReady = jest.fn();
    const onLoaded = jest.fn();
    const props = platformizedMapViewProps({
      chrome,
      onMapReady: onReady,
      onAndroidMapReady: onAndroidReady,
      onAndroidMapLoaded: onLoaded,
      onUserLocationSample: onSample,
    });

    expect(props.provider).toBeUndefined();
    expect(props.showsPointsOfInterests).toBe(true);
    expect(props.compassOffset).toEqual(chrome.compassOffset);
    expect(props.appleLogoInsets).toEqual(chrome.appleLogoInsets);
    expect(props.onMapLoaded).toBeUndefined();
    props.onMapReady?.();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onAndroidReady).not.toHaveBeenCalled();
    props.onUserLocationChange?.({
      nativeEvent: { coordinate: { latitude: 25, longitude: 121, accuracy: 4, timestamp: 10 } },
    });
    expect(onSample).toHaveBeenCalledWith({
      coordinates: { latitude: 25, longitude: 121 },
      accuracy: 4,
      timestamp: 10,
    });
  });

  it('returns Google provider and Android lifecycle callbacks on Android', () => {
    platform.OS = 'android';
    const onReady = jest.fn();
    const onAndroidReady = jest.fn();
    const onLoaded = jest.fn();
    const onSample = jest.fn();
    const props = platformizedMapViewProps({
      chrome,
      onMapReady: onReady,
      onAndroidMapReady: onAndroidReady,
      onAndroidMapLoaded: onLoaded,
      onUserLocationSample: onSample,
    });

    expect(props.provider).toBe('google');
    expect(props.showsTransit).toBe(true);
    expect(props.compassOffset).toBeUndefined();
    expect(props.onUserLocationChange).toBeUndefined();
    props.onMapReady?.();
    props.onMapLoaded?.();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onAndroidReady).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onSample).not.toHaveBeenCalled();
  });

  it('returns safe fallback props on unsupported runtimes', () => {
    platform.OS = 'web';
    const props = platformizedMapViewProps({
      chrome,
      onAndroidMapReady: jest.fn(),
      onAndroidMapLoaded: jest.fn(),
      onUserLocationSample: jest.fn(),
    });

    expect(props).toEqual({});
  });
});
