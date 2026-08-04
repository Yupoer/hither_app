const mockGetDirections = jest.fn();
const mockProxyGetDirections = jest.fn();

jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => ({
    searchPlaces: jest.fn(),
    getDirections: mockGetDirections,
  }),
}));

jest.mock('../native/googleMapsProxy', () => ({
  MapsProxyError: class MapsProxyError extends Error {
    code: string;
    status: number;
    constructor(code: string, status: number) {
      super(code);
      this.code = code;
      this.status = status;
    }
  },
  proxySearchPlaces: jest.fn(),
  proxyGetDirections: (...args: unknown[]) => mockProxyGetDirections(...args),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { getDirections } from '../native/maps';
import { simplifyRoutePointsForDisplay } from '../utils/routeLod';

const from = { latitude: 25.033, longitude: 121.5654 };
const to = { latitude: 25.0478, longitude: 121.517 };

describe('getDirections', () => {
  beforeEach(() => {
    mockGetDirections.mockReset();
    mockProxyGetDirections.mockReset();
  });

  it('returns the native MapKit route for the selected travel mode', async () => {
    const route = {
      distanceMeters: 1234,
      expectedTravelTimeSeconds: 900,
      points: [from, to],
    };
    mockGetDirections.mockResolvedValue(route);

    await expect(getDirections(from, to, 'drive')).resolves.toEqual({
      ...route,
      source: 'native',
    });
    expect(mockGetDirections).toHaveBeenCalledWith(from, to, 'drive');
    expect(mockProxyGetDirections).not.toHaveBeenCalled();
  });

  it('falls through to Google proxy when MapKit cannot provide a route', async () => {
    mockGetDirections.mockRejectedValue(new Error('No route'));
    const proxyRoute = {
      distanceMeters: 2000,
      expectedTravelTimeSeconds: 600,
      points: [from, to],
      source: 'google' as const,
    };
    mockProxyGetDirections.mockResolvedValue(proxyRoute);

    await expect(getDirections(from, to, 'walk')).resolves.toEqual(proxyRoute);
    expect(mockProxyGetDirections).toHaveBeenCalledWith(from, to, 'walk');
  });

  it('uses Google transit geometry directly on iOS', async () => {
    const proxyRoute = {
      distanceMeters: 2000,
      expectedTravelTimeSeconds: 600,
      points: [from, to],
      source: 'google' as const,
    };
    mockProxyGetDirections.mockResolvedValue(proxyRoute);

    await expect(getDirections(from, to, 'transit')).resolves.toEqual(proxyRoute);
    expect(mockGetDirections).not.toHaveBeenCalled();
    expect(mockProxyGetDirections).toHaveBeenCalledWith(from, to, 'transit');
  });

  it('returns null when both native and proxy fail', async () => {
    mockGetDirections.mockRejectedValue(new Error('No route'));
    mockProxyGetDirections.mockRejectedValue(new Error('quota'));

    await expect(getDirections(from, to, 'walk')).resolves.toBeNull();
  });

  it('treats empty native points as miss and tries proxy', async () => {
    mockGetDirections.mockResolvedValue({
      distanceMeters: 0,
      expectedTravelTimeSeconds: 0,
      points: [],
    });
    mockProxyGetDirections.mockResolvedValue(null);
    await expect(getDirections(from, to, 'drive')).resolves.toBeNull();
    expect(mockProxyGetDirections).toHaveBeenCalled();
  });
});

describe('display route simplification fixture', () => {
  it('removes a short square bump while preserving route endpoints', () => {
    const points = [
      from,
      { latitude: from.latitude, longitude: from.longitude + 0.0002 },
      { latitude: from.latitude + 0.000045, longitude: from.longitude + 0.0002 },
      { latitude: from.latitude + 0.000045, longitude: from.longitude + 0.0004 },
      { latitude: from.latitude, longitude: from.longitude + 0.0006 },
    ];
    expect(simplifyRoutePointsForDisplay(points, 10)).toEqual([points[0], points[4]]);
  });

  it('keeps a meaningful turn above the tolerance', () => {
    const turn = {
      latitude: from.latitude + 0.0002,
      longitude: from.longitude + 0.0003,
    };
    const points = [
      from,
      turn,
      { latitude: from.latitude, longitude: from.longitude + 0.0006 },
    ];
    expect(simplifyRoutePointsForDisplay(points, 10)).toEqual(points);
  });
});
