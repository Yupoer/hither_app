import React from 'react';
import { usePersonalProgressSurfaces, type PersonalProgressSurfaces } from '../screens/MapScreen/hooks/usePersonalProgressSurfaces';
import { useMapKitRoutes } from '../screens/MapScreen/hooks/useMapKitRoutes';
import { getDirections } from '../native/maps';
import { etaSecondsFor, type TravelMode } from '../utils/geo';
import { derivePersonalProgress } from '../utils/personalProgress';
jest.mock('../native/maps', () => ({ getDirections: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');
const mockRoute = getDirections as jest.MockedFunction<typeof getDirections>;
const from = { latitude: 25, longitude: 121 };
const target = { id: 'stop', coordinates: { latitude: 25.01, longitude: 121 } };

it('switches both surface ETAs while pending and ignores an out-of-order mode completion', async () => {
  const resolvers: Partial<Record<TravelMode, (route: Awaited<ReturnType<typeof getDirections>>) => void>> = {};
  mockRoute.mockImplementation((_from, _to, mode) => new Promise(done => { resolvers[mode] = done; }));
  let surfaces!: PersonalProgressSurfaces;
  let routes!: ReturnType<typeof useMapKitRoutes>;
  function Harness({ mode }: { mode: TravelMode }) {
    routes = useMapKitRoutes({ selfCoordinates: from, gathering: target, members: [], travelMode: mode });
    surfaces = usePersonalProgressSurfaces({ resetKey: 'journey', deviceCoords: from,
      targetCoords: target.coordinates, initialDistanceM: 2000, distanceSource: 'route',
      travelMode: mode, routeDistanceM: routes.selfRoute?.distanceMeters,
      routeEtaSeconds: routes.selfRoute?.expectedTravelTimeSeconds, routeResultGeneration: routes.selfRouteGeneration,
      lastValidDistanceM: 1000, lastValidEtaSeconds: 570, lastValidEtaTravelMode: 'walk',
      lastValidProgress: 0.5, lastRouteDistanceM: 1000, arrivalRadiusM: 50 });
    return null;
  }
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(Harness, { mode: 'walk' })); });
  const route = (seconds: number) => ({ distanceMeters: 1000, expectedTravelTimeSeconds: seconds, points: [from, target.coordinates] });
  await act(async () => { resolvers.walk!(route(600)); });
  const progress = surfaces.gatheringCard.progress;
  await act(async () => { tree.update(React.createElement(Harness, { mode: 'drive' })); });
  expect(routes.selfRoute).toBeNull();
  expect(surfaces.gatheringCard.etaSeconds).toBeCloseTo(95);
  expect(surfaces.gatheringCard.progress).toBe(progress);
  expect(surfaces.gatheringCard).toEqual(surfaces.liveActivityPayload);
  await act(async () => { tree.update(React.createElement(Harness, { mode: 'bicycle' })); });
  expect(surfaces.gatheringCard.etaSeconds).toBeCloseTo(950 / 4.2);
  await act(async () => { resolvers.drive!(route(75)); });
  expect(routes.selfRoute).toBeNull();
  expect(surfaces.gatheringCard.etaSeconds).toBeCloseTo(950 / 4.2);
  await act(async () => { resolvers.bicycle!(route(300)); });
  expect(surfaces.gatheringCard.etaSeconds).toBeCloseTo(285);
  expect(surfaces.gatheringCard.progress).toBe(progress);
  await act(async () => tree.unmount());
});

it.each([null, from])('recalculates stale sticky ETA for bicycle preserving progress (GPS %p)', coords => {
  const result = derivePersonalProgress({ deviceCoords: coords, targetCoords: target.coordinates,
    initialDistanceM: 2000, hasDepartedStart: true, travelMode: 'bicycle', sampleAgeMs: 60000,
    lastValidDistanceM: 1000, lastValidEtaSeconds: 570, lastValidEtaTravelMode: 'walk',
    lastValidProgress: 0.5, arrivalRadiusM: 50 });
  expect(result.distanceMeters).toBe(1000);
  expect(result.progress).toBe(0.5);
  expect(result.etaSeconds).toBeCloseTo(etaSecondsFor(950, 'bicycle'));
  expect(result.freshness).toBe('stale');
});

it('rebases a stale deadline on mode change even with an unchanged GPS sample time', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(100000);
  let surfaces!: PersonalProgressSurfaces;
  function Harness({ mode }: { mode: TravelMode }) {
    surfaces = usePersonalProgressSurfaces({ resetKey: 'journey', deviceCoords: null,
      targetCoords: target.coordinates, initialDistanceM: 2000, travelMode: mode,
      sampledAtMs: 1000, lastValidDistanceM: 1000, lastValidEtaSeconds: 570,
      lastValidEtaTravelMode: 'walk', lastValidProgress: 0.5, arrivalRadiusM: 50 });
    return null;
  }
  let tree: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(Harness, { mode: 'walk' })); });
  await act(async () => { tree.update(React.createElement(Harness, { mode: 'bicycle' })); });
  expect(surfaces.gatheringCard.etaSampledAtMs).toBe(100000);
  expect(surfaces.gatheringCard.etaTargetAtMs).toBeCloseTo(100000 + 950 / 4.2 * 1000);
  expect(surfaces.gatheringCard).toEqual(surfaces.liveActivityPayload);
  await act(async () => tree.unmount());
  jest.restoreAllMocks();
});
