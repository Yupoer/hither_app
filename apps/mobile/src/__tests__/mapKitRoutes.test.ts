import React from 'react';
import { getDirections } from '../native/maps';
import {
  loadMapKitRoutes,
  membersRouteSignature,
  routeCacheKey,
  useMapKitRoutes,
} from '../screens/MapScreen/hooks/useMapKitRoutes';
import { usePersonalProgressSurfaces } from '../screens/MapScreen/hooks/usePersonalProgressSurfaces';

jest.mock('../native/maps', () => ({ getDirections: jest.fn() }));

const mockGetDirections = getDirections as jest.MockedFunction<typeof getDirections>;
const gathering = { coordinates: { latitude: 25.05, longitude: 121.52 } };
const me = { latitude: 25.03, longitude: 121.56 };
/** ~200m south — clears default route recompute distance gate. */
const meFarther = { latitude: 25.0282, longitude: 121.56 };
const members = [
  { userId: 'a', coordinates: { latitude: 25.01, longitude: 121.51 } },
  { userId: 'b', coordinates: { latitude: 25.02, longitude: 121.52 } },
];

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  create: (element: React.ReactElement) => {
    update: (next: React.ReactElement) => void;
    unmount: () => void;
  };
};

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

  it('fetches only the selected travel mode (no multi-mode overlay routes)', async () => {
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
    });

    expect(mockGetDirections).toHaveBeenCalledTimes(1);
    expect(mockGetDirections).toHaveBeenCalledWith(me, gathering.coordinates, 'walk');
    expect(routes.selfRoute?.expectedTravelTimeSeconds).toBe(600);
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

describe('useMapKitRoutes + MapScreen progress surfaces (#145 Sol r4)', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    mockGetDirections.mockReset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('bumps generation on two equal-distance completions and snaps progress', async () => {
    // Production seam: accepted useMapKitRoutes results update the shared
    // MapScreen progress hook. Equal remaining metres must still re-anchor.
    mockGetDirections
      .mockResolvedValueOnce({
        distanceMeters: 1000,
        expectedTravelTimeSeconds: 900,
        points: [me, gathering.coordinates],
      })
      .mockResolvedValueOnce({
        distanceMeters: 1000, // same integer remaining
        expectedTravelTimeSeconds: 720, // new ETA for new origin
        points: [meFarther, gathering.coordinates],
      });

    let routes: ReturnType<typeof useMapKitRoutes> | undefined;
    let surfaces: ReturnType<typeof usePersonalProgressSurfaces> | undefined;
    function Harness(props: {
      self: { latitude: number; longitude: number };
    }) {
      routes = useMapKitRoutes({
        selfCoordinates: props.self,
        members: [],
        gathering,
        travelMode: 'walk',
      });
      surfaces = usePersonalProgressSurfaces({
        resetKey: 'gps-route-test',
        deviceCoords: props.self,
        targetCoords: gathering.coordinates,
        initialDistanceM: 2000,
        startCoords: me,
        hasDepartedStart: true,
        travelMode: 'walk',
        distanceSource: 'route',
        routeDistanceM: routes.selfRoute?.distanceMeters,
        routeEtaSeconds: routes.selfRoute?.expectedTravelTimeSeconds,
        lastRouteDistanceM: routes.selfRoute?.distanceMeters,
        routeResultGeneration: routes.selfRouteGeneration,
        fallbackDistanceM: routes.selfRoute?.distanceMeters,
        fallbackEtaSeconds: routes.selfRoute?.expectedTravelTimeSeconds,
      });
      return null;
    }

    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(React.createElement(Harness, { self: me }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(routes?.selfRoute?.distanceMeters).toBe(1000);
    expect(routes?.selfRouteGeneration).toBe(1);
    expect(surfaces?.routeAnchor?.gps).toEqual(me);
    expect(surfaces?.gatheringCard.distanceMeters).toBe(1000);
    expect(surfaces?.liveActivityPayload.distanceMeters).toBe(1000);
    expect(surfaces?.gatheringCard).toEqual(surfaces?.liveActivityPayload);

    // GPS moves between throttled route results → local remaining drops.
    const midGps = { latitude: 25.0295, longitude: 121.56 };
    await act(async () => {
      tree.update(React.createElement(Harness, { self: midGps }));
    });
    expect(routes?.selfRouteGeneration).toBe(1);
    expect(surfaces?.gatheringCard.distanceMeters!).toBeLessThan(1000);
    expect(surfaces?.gatheringCard.etaSeconds!).toBeLessThan(900);
    expect(surfaces?.gatheringCard.progress!).toBeGreaterThan(0.5);
    expect(surfaces?.gatheringCard).toEqual(surfaces?.liveActivityPayload);

    // Advance wall clock past routeMinIntervalMs * 0.4 so recompute can fire.
    await act(async () => {
      jest.advanceTimersByTime(40_000);
    });

    await act(async () => {
      tree.update(React.createElement(Harness, { self: meFarther }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetDirections).toHaveBeenCalledTimes(2);
    expect(routes?.selfRoute?.distanceMeters).toBe(1000);
    expect(routes?.selfRouteGeneration).toBe(2);
    expect(surfaces?.isNewRouteResult).toBe(true);
    expect(surfaces?.routeAnchor?.generation).toBe(2);

    expect(surfaces?.gatheringCard.distanceMeters).toBe(1000);
    expect(surfaces?.gatheringCard.etaSeconds).toBe(720);
    expect(surfaces?.gatheringCard.progress).toBe(0.5);
    expect(surfaces?.liveActivityPayload.distanceMeters).toBe(1000);
    expect(surfaces?.liveActivityPayload.etaSeconds).toBe(720);
    expect(surfaces?.liveActivityPayload.progress).toBe(0.5);
    expect(surfaces?.gatheringCard).toEqual(surfaces?.liveActivityPayload);

    await act(async () => {
      tree.unmount();
    });
  });

});
