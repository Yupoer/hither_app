import { getDirections } from '../native/maps';
import {
  loadMapKitRoutes,
  membersRouteSignature,
  routeCacheKey,
} from '../screens/MapScreen/hooks/useMapKitRoutes';

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

  it('by default only routes self (no per-member MapKit calls)', async () => {
    mockGetDirections.mockImplementation(async (from) => ({
      distanceMeters: 1000,
      expectedTravelTimeSeconds: 600,
      points: [from, gathering.coordinates],
    }));

    const routes = await loadMapKitRoutes({
      selfCoordinates: me,
      members,
      gathering,
      travelMode: 'walk',
    });

    expect(mockGetDirections).toHaveBeenCalledTimes(1);
    expect(mockGetDirections).toHaveBeenCalledWith(me, gathering.coordinates, 'walk');
    expect(routes.memberRoutes).toEqual({});
    expect(routes.selfRoute?.expectedTravelTimeSeconds).toBe(600);
  });

  it('calculates each member ETA only when includeMemberRoutes is true', async () => {
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
      includeMemberRoutes: true,
    });

    expect(mockGetDirections).toHaveBeenCalledWith(members[0].coordinates, gathering.coordinates, 'walk');
    expect(mockGetDirections).toHaveBeenCalledWith(members[1].coordinates, gathering.coordinates, 'walk');
    expect(routes.memberRoutes.a.expectedTravelTimeSeconds).toBe(600);
    expect(routes.memberRoutes.b.expectedTravelTimeSeconds).toBe(1200);
  });

  it('precomputes all travel modes only while journey is active', async () => {
    mockGetDirections.mockImplementation(async (from, _to, mode) => ({
      distanceMeters: 1000,
      expectedTravelTimeSeconds: mode === 'drive' ? 300 : 600,
      points: [from, gathering.coordinates],
    }));

    const routes = await loadMapKitRoutes({
      selfCoordinates: me,
      members: [],
      gathering,
      travelMode: 'walk',
      journeyActive: true,
    });

    expect(mockGetDirections.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(routes.allModeRoutes.walk).toBeTruthy();
    expect(routes.allModeRoutes.transit).toBeTruthy();
    expect(routes.allModeRoutes.drive).toBeTruthy();
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
      includeMemberRoutes: true,
    });

    expect(routes.memberRoutes.a).toBeUndefined();
    expect(routes.memberRoutes.b.expectedTravelTimeSeconds).toBe(1200);
  });
});

describe('route signatures', () => {
  it('quantizes cache keys so tiny jitter collides', () => {
    const a = routeCacheKey(
      { latitude: 25.12341, longitude: 121.98761 },
      gathering.coordinates,
      'walk',
      4,
    );
    const b = routeCacheKey(
      { latitude: 25.12344, longitude: 121.98764 },
      gathering.coordinates,
      'walk',
      4,
    );
    expect(a).toBe(b);
  });

  it('builds a stable member signature', () => {
    const sig = membersRouteSignature(members, 4);
    expect(sig).toContain('a:');
    expect(sig).toContain('b:');
  });
});
