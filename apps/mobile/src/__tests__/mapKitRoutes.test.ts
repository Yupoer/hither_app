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

    // This GPS move is away from the target; local distance/ETA increase without a route request.
    const midGps = { latitude: 25.0295, longitude: 121.56 };
    await act(async () => {
      tree.update(React.createElement(Harness, { self: midGps }));
    });
    expect(routes?.selfRouteGeneration).toBe(1);
    expect(surfaces?.gatheringCard.distanceMeters!).toBeGreaterThan(1000);
    expect(surfaces?.gatheringCard.etaSeconds!).toBeGreaterThan(855);
    expect(surfaces?.gatheringCard.progress!).toBeLessThan(1000 / 1950);
    expect(surfaces?.gatheringCard).toEqual(surfaces?.liveActivityPayload);

    // Advance wall clock past the full route interval so recompute can fire.
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
    expect(surfaces?.gatheringCard.etaSeconds).toBe(684);
    expect(surfaces?.gatheringCard.progress).toBeCloseTo(1000 / 1950);
    expect(surfaces?.liveActivityPayload.distanceMeters).toBe(1000);
    expect(surfaces?.liveActivityPayload.etaSeconds).toBe(684);
    expect(surfaces?.liveActivityPayload.progress).toBeCloseTo(1000 / 1950);
    expect(surfaces?.gatheringCard).toEqual(surfaces?.liveActivityPayload);

    await act(async () => {
      tree.unmount();
    });
  });

  it('does not call getDirections for local GPS trim and clears on travel mode change', async () => {
    mockGetDirections.mockResolvedValue({
      distanceMeters: 1000,
      expectedTravelTimeSeconds: 600,
      points: [me, gathering.coordinates],
    });

    let routes: ReturnType<typeof useMapKitRoutes> | undefined;
    function Harness(props: {
      self: { latitude: number; longitude: number };
      travelMode: 'walk' | 'drive' | 'transit';
    }) {
      routes = useMapKitRoutes({
        selfCoordinates: props.self,
        members: [],
        gathering,
        travelMode: props.travelMode,
      });
      return null;
    }

    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(React.createElement(Harness, { self: me, travelMode: 'walk' }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockGetDirections).toHaveBeenCalledTimes(1);
    expect(routes?.selfRoute?.points[0]).toEqual(me);

    const midGps = { latitude: 25.0295, longitude: 121.56 };
    await act(async () => {
      tree.update(React.createElement(Harness, { self: midGps, travelMode: 'walk' }));
    });
    expect(mockGetDirections).toHaveBeenCalledTimes(1);
    expect(routes?.selfRouteGeneration).toBe(1);

    mockGetDirections.mockClear();
    mockGetDirections.mockImplementation(() => new Promise(() => undefined));
    await act(async () => {
      tree.update(React.createElement(Harness, { self: midGps, travelMode: 'transit' }));
    });
    expect(routes?.selfRoute).toBeNull();
    expect(mockGetDirections).toHaveBeenCalledWith(me, gathering.coordinates, 'transit');

    await act(async () => {
      tree.unmount();
    });
  });

  it('does not permanently cache an unavailable route', async () => {
    mockGetDirections
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        distanceMeters: 800,
        expectedTravelTimeSeconds: 480,
        points: [me, gathering.coordinates],
      });

    let routes: ReturnType<typeof useMapKitRoutes> | undefined;
    function Harness({ showTarget }: { showTarget: boolean }) {
      routes = useMapKitRoutes({
        selfCoordinates: me,
        members: [],
        gathering: showTarget ? gathering : null,
        travelMode: 'walk',
      });
      return null;
    }

    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(React.createElement(Harness, { showTarget: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(routes?.selfRoute).toBeNull();
    expect(mockGetDirections).toHaveBeenCalledTimes(1);

    await act(async () => {
      tree.update(React.createElement(Harness, { showTarget: false }));
    });
    await act(async () => {
      tree.update(React.createElement(Harness, { showTarget: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetDirections).toHaveBeenCalledTimes(2);
    expect(routes?.selfRoute?.distanceMeters).toBe(800);
    await act(async () => {
      tree.unmount();
    });
  });

});

it('does not force fresh distance progress to zero or reuse the previous milestone on a new journey', async () => {
  let surface: ReturnType<typeof usePersonalProgressSurfaces> | undefined;
  function Harness({ resetKey }: { resetKey: string }) {
    surface = usePersonalProgressSurfaces({ resetKey, deviceCoords: { latitude: 25, longitude: 121 },
      targetCoords: { latitude: 25.01, longitude: 121 }, travelMode: 'walk',
      initialDistanceM: 2000, previousProgressMax: 0.8, hasDepartedStart: true });
    return null;
  }
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(Harness, { resetKey: 'old-session' })); });
  const actualDistanceProgress = surface?.gatheringCard.progress;
  expect(actualDistanceProgress).toBeGreaterThan(0);
  expect(actualDistanceProgress).toBeLessThan(0.8);
  await act(async () => { tree.update(React.createElement(Harness, { resetKey: 'new-session' })); });
  expect(surface?.gatheringCard.progress).toBe(actualDistanceProgress);
  expect(surface?.liveActivityPayload.progress).toBe(actualDistanceProgress);
  await act(async () => { tree.unmount(); });
});

it('shows 100% on the first render of a tiny trip already inside the radius', async () => {
  let surface: ReturnType<typeof usePersonalProgressSurfaces> | undefined;
  function Harness({ resetKey }: { resetKey: string }) {
    surface = usePersonalProgressSurfaces({ resetKey, deviceCoords: me, targetCoords: me,
      initialDistanceM: 40, arrivalRadiusM: 50, travelMode: 'walk', sampledAtMs: 1000 });
    return null;
  }
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(Harness, { resetKey: 'tiny-1' })); });
  expect(surface?.gatheringCard.progress).toBe(1);
  expect(surface?.gatheringCard.etaSeconds).toBe(0);
  expect(surface?.personalProgress.arrived).toBe(false);
  await act(async () => { tree.update(React.createElement(Harness, { resetKey: 'tiny-2' })); });
  expect(surface?.liveActivityPayload.progress).toBe(1);
  await act(async () => { tree.unmount(); });
});

describe('destination changes while directions are pending', () => {
  const nextStop = { coordinates: { latitude: 25.06, longitude: 121.54 } };
  type Route = NonNullable<ReturnType<typeof useMapKitRoutes>['selfRoute']>;
  function deferredRoute() {
    let resolve!: (route: Route | null) => void;
    const promise = new Promise<Route | null>((done) => { resolve = done; });
    return { promise, resolve };
  }
  const routeTo = (target: typeof gathering): Route => ({
    distanceMeters: target === gathering ? 5200 : 1400,
    expectedTravelTimeSeconds: target === gathering ? 3600 : 1020,
    points: [me, target.coordinates],
  });
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockGetDirections.mockReset();
  });

  it('hides the previous destination route in every render until the replacement arrives', async () => {
    const replacement = deferredRoute();
    mockGetDirections.mockResolvedValueOnce(routeTo(gathering)).mockReturnValueOnce(replacement.promise);
    let routes: ReturnType<typeof useMapKitRoutes>;
    const renderedRoutes: Array<ReturnType<typeof useMapKitRoutes>['selfRoute']> = [];
    function Harness({ target }: { target: typeof gathering }) {
      routes = useMapKitRoutes({ selfCoordinates: me, members: [], gathering: target, travelMode: 'walk' });
      renderedRoutes.push(routes.selfRoute);
      return null;
    }
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(React.createElement(Harness, { target: gathering })); });
    expect(routes!.selfRoute?.distanceMeters).toBe(5200);
    renderedRoutes.length = 0;
    await act(async () => { tree.update(React.createElement(Harness, { target: nextStop })); });
    // A new destination title must never inherit the previous stop's path/ETA.
    expect(renderedRoutes.every((route) => route === null)).toBe(true);
    await act(async () => { replacement.resolve(routeTo(nextStop)); });
    expect(routes!.selfRoute?.points.at(-1)).toEqual(nextStop.coordinates);
    expect(routes!.selfRoute?.distanceMeters).toBe(1400);
    await act(async () => { tree.unmount(); });
  });

  it('accepts the in-flight request after gated GPS and equal-target rerenders', async () => {
    const pending = deferredRoute();
    mockGetDirections.mockReturnValue(pending.promise);
    let routes: ReturnType<typeof useMapKitRoutes>;
    function Harness({ self }: { self: typeof me }) {
      routes = useMapKitRoutes({ selfCoordinates: self, members: [],
        gathering: { coordinates: { ...gathering.coordinates } }, travelMode: 'walk' });
      return null;
    }
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(React.createElement(Harness, { self: me })); });
    await act(async () => { tree.update(React.createElement(Harness,
      { self: { latitude: me.latitude + 0.000001, longitude: me.longitude } })); });
    await act(async () => { pending.resolve(routeTo(gathering)); });
    expect(mockGetDirections).toHaveBeenCalledTimes(1);
    expect(routes!.selfRoute?.distanceMeters).toBe(5200);
    expect(routes!.selfRouteGeneration).toBe(1);
    await act(async () => { tree.unmount(); });
  });

  it('rejects late old-target results and clears on target removal', async () => {
    const old = deferredRoute();
    const replacement = deferredRoute();
    mockGetDirections.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
    let routes: ReturnType<typeof useMapKitRoutes>;
    function Harness({ target }: { target: typeof gathering | null }) {
      routes = useMapKitRoutes({ selfCoordinates: me, members: [], gathering: target, travelMode: 'walk' });
      return null;
    }
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(React.createElement(Harness, { target: gathering })); });
    await act(async () => { tree.update(React.createElement(Harness, { target: nextStop })); });
    await act(async () => { replacement.resolve(routeTo(nextStop)); });
    await act(async () => { old.resolve(routeTo(gathering)); });
    expect(routes!.selfRoute?.points.at(-1)).toEqual(nextStop.coordinates);
    await act(async () => { tree.update(React.createElement(Harness, { target: null })); });
    expect(routes!.selfRoute).toBeNull();
    await act(async () => { tree.unmount(); });
  });

  it('routes a destination change inside the same quantized bucket', async () => {
    const nearbyStop = { coordinates: { ...gathering.coordinates,
      latitude: gathering.coordinates.latitude + 0.000001 } };
    const replacement = deferredRoute();
    mockGetDirections.mockResolvedValueOnce(routeTo(gathering)).mockReturnValueOnce(replacement.promise);
    let routes: ReturnType<typeof useMapKitRoutes>;
    function Harness({ target }: { target: typeof gathering }) {
      routes = useMapKitRoutes({ selfCoordinates: me, members: [], gathering: target, travelMode: 'walk' });
      return null;
    }
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(React.createElement(Harness, { target: gathering })); });
    await act(async () => { tree.update(React.createElement(Harness, { target: nearbyStop })); });
    expect(routes!.selfRoute).toBeNull();
    expect(mockGetDirections).toHaveBeenCalledTimes(2);
    await act(async () => { replacement.resolve(routeTo(nearbyStop)); });
    expect(routes!.selfRoute?.points.at(-1)).toEqual(nearbyStop.coordinates);
    await act(async () => { tree.unmount(); });
  });

  it('reattaches to the original cached request on A to B to A without accepting B', async () => {
    const old = deferredRoute();
    const replacement = deferredRoute();
    mockGetDirections.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
    let routes: ReturnType<typeof useMapKitRoutes>;
    function Harness({ target }: { target: typeof gathering }) {
      routes = useMapKitRoutes({ selfCoordinates: me, members: [], gathering: target, travelMode: 'walk' });
      return null;
    }
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(React.createElement(Harness, { target: gathering })); });
    await act(async () => { tree.update(React.createElement(Harness, { target: nextStop })); });
    await act(async () => { tree.update(React.createElement(Harness, { target: gathering })); });
    await act(async () => { replacement.resolve(routeTo(nextStop)); });
    expect(routes!.selfRoute).toBeNull();
    await act(async () => { old.resolve(routeTo(gathering)); });
    expect(routes!.selfRoute?.points.at(-1)).toEqual(gathering.coordinates);
    expect(mockGetDirections).toHaveBeenCalledTimes(2);
    await act(async () => { tree.unmount(); });
  });

  it('accepts a pending cached result after StrictMode effect replay and ignores unmount completion', async () => {
    const pending = deferredRoute();
    const afterUnmount = deferredRoute();
    mockGetDirections.mockReturnValueOnce(pending.promise).mockReturnValueOnce(afterUnmount.promise);
    let routes: ReturnType<typeof useMapKitRoutes>;
    let renders = 0;
    function Harness({ target }: { target: typeof gathering }) {
      routes = useMapKitRoutes({ selfCoordinates: me, members: [], gathering: target, travelMode: 'walk' });
      renders += 1;
      return null;
    }
    const element = (target: typeof gathering) => React.createElement(React.StrictMode, null,
      React.createElement(Harness, { target }));
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(element(gathering)); });
    await act(async () => { pending.resolve(routeTo(gathering)); });
    expect(routes!.selfRoute?.distanceMeters).toBe(5200);
    expect(mockGetDirections).toHaveBeenCalledTimes(1);
    await act(async () => { tree.update(element(nextStop)); });
    await act(async () => { tree.unmount(); });
    const unmountedRenders = renders;
    await act(async () => { afterUnmount.resolve(routeTo(nextStop)); });
    expect(renders).toBe(unmountedRenders);
  });
});

describe('paused navigation directions ownership', () => {
  it('does not request directions from paused GPS and drops an in-flight navigation result', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockGetDirections.mockReset();
    let resolveRoute!: (route: Awaited<ReturnType<typeof getDirections>>) => void;
    mockGetDirections.mockImplementation(() => new Promise<Awaited<ReturnType<typeof getDirections>>>(resolve => { resolveRoute = resolve; }));
    let routes!: ReturnType<typeof useMapKitRoutes>;
    function Harness({ navigationActive, self }: { navigationActive: boolean; self: typeof me }) {
      routes = useMapKitRoutes({ selfCoordinates: self, members: [],
        gathering: navigationActive ? gathering : null, travelMode: 'walk' });
      return null;
    }
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(React.createElement(Harness, { navigationActive: false, self: me })); });
    await act(async () => { tree.update(React.createElement(Harness, { navigationActive: false, self: meFarther })); });
    expect(mockGetDirections).not.toHaveBeenCalled();
    await act(async () => { tree.update(React.createElement(Harness, { navigationActive: true, self: meFarther })); });
    expect(mockGetDirections).toHaveBeenCalledTimes(1);
    await act(async () => { tree.update(React.createElement(Harness, { navigationActive: false, self: me })); });
    await act(async () => { resolveRoute({ distanceMeters: 1000, expectedTravelTimeSeconds: 600,
      points: [meFarther, gathering.coordinates] }); });
    expect(routes.selfRoute).toBeNull();
    expect(mockGetDirections).toHaveBeenCalledTimes(1);
    await act(async () => { tree.unmount(); });
  });
});
