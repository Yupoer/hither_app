const mockGetDirections = jest.fn();

jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => ({
    searchPlaces: jest.fn(),
    getDirections: mockGetDirections,
  }),
}));

import { getDirections } from '../native/maps';

const from = { latitude: 25.033, longitude: 121.5654 };
const to = { latitude: 25.0478, longitude: 121.517 };

describe('getDirections', () => {
  beforeEach(() => mockGetDirections.mockReset());

  it('returns the native MapKit route for the selected travel mode', async () => {
    const route = {
      distanceMeters: 1234,
      expectedTravelTimeSeconds: 900,
      points: [from, to],
    };
    mockGetDirections.mockResolvedValue(route);

    await expect(getDirections(from, to, 'drive')).resolves.toEqual(route);
    expect(mockGetDirections).toHaveBeenCalledWith(from, to, 'drive');
  });

  it('returns null when MapKit cannot provide a route', async () => {
    mockGetDirections.mockRejectedValue(new Error('No route'));

    await expect(getDirections(from, to, 'walk')).resolves.toBeNull();
  });
});
