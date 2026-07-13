import { getDirections } from '../native/maps';
import { loadMapKitRoutes } from '../screens/MapScreen/hooks/useMapKitRoutes';

jest.mock('../native/maps', () => ({ getDirections: jest.fn() }));

const mockGetDirections = getDirections as jest.MockedFunction<typeof getDirections>;
const gathering = { coordinates: { latitude: 25.05, longitude: 121.52 } };
const me = { latitude: 25.03, longitude: 121.56 };
const members = [
  { userId: 'a', coordinates: { latitude: 25.01, longitude: 121.51 } },
  { userId: 'b', coordinates: { latitude: 25.02, longitude: 121.52 } },
];

describe('loadMapKitRoutes', () => {
  beforeEach(() => mockGetDirections.mockReset());

  it('calculates each member ETA from that member to the gathering point', async () => {
    mockGetDirections.mockImplementation(async (from) => ({
      distanceMeters: from.latitude === members[0].coordinates.latitude ? 1000 : 2000,
      expectedTravelTimeSeconds: from.latitude === members[0].coordinates.latitude ? 600 : 1200,
      points: [from, gathering.coordinates],
    }));

    const routes = await loadMapKitRoutes({
      selfCoordinates: me,
      members,
      gathering,
      travelMode: 'walk',
    });

    expect(mockGetDirections).toHaveBeenCalledWith(members[0].coordinates, gathering.coordinates, 'walk');
    expect(mockGetDirections).toHaveBeenCalledWith(members[1].coordinates, gathering.coordinates, 'walk');
    expect(routes.memberRoutes.a.expectedTravelTimeSeconds).toBe(600);
    expect(routes.memberRoutes.b.expectedTravelTimeSeconds).toBe(1200);
  });

  it('keeps other member ETAs when one route is unavailable', async () => {
    mockGetDirections.mockImplementation(async (from) =>
      from.latitude === members[0].coordinates.latitude
        ? null
        : {
            distanceMeters: 2000,
            expectedTravelTimeSeconds: 1200,
            points: [from, gathering.coordinates],
          },
    );

    const routes = await loadMapKitRoutes({
      selfCoordinates: undefined,
      members,
      gathering,
      travelMode: 'walk',
    });

    expect(routes.memberRoutes.a).toBeUndefined();
    expect(routes.memberRoutes.b.expectedTravelTimeSeconds).toBe(1200);
  });
});
