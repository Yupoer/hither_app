import { cachedRouteRequest, ROUTE_CACHE_MAX_ENTRIES, ROUTE_CACHE_MAX_POINTS, ROUTE_CACHE_TTL_MS, type RouteCacheEntry } from '../utils/routeRequestCache';

it('bounds a long map session to 24 geometries while reusing recent results', async () => {
  const cache = new Map<string, RouteCacheEntry>();
  const load = jest.fn(async () => ({ distanceMeters: 1, expectedTravelTimeSeconds: 1,
    points: Array.from({ length: 1000 }, (_, i) => ({ latitude: 35 + i / 100_000, longitude: 139 })) }));
  for (let i = 0; i < 2000; i++) await cachedRouteRequest(cache, String(i), load, i);
  expect(load).toHaveBeenCalledTimes(2000);
  expect(cache.size).toBe(ROUTE_CACHE_MAX_ENTRIES);
  expect((await Promise.all([...cache.values()].map(entry => entry.request))).reduce((sum, route) => sum + route!.points.length, 0)).toBe(24_000);
  await cachedRouteRequest(cache, '1999', load, 2000);
  expect(load).toHaveBeenCalledTimes(2000);
  await cachedRouteRequest(cache, '0', load, 2000);
  expect(load).toHaveBeenCalledTimes(2001);
  expect(cache.size).toBe(24);
});

it('deduplicates in-flight routes, expires stale geometry, and does not retain failed requests', async () => {
  const cache = new Map<string, RouteCacheEntry>();
  let resolve!: (value: null) => void;
  const load = jest.fn(() => new Promise<null>(done => { resolve = done; }));
  const first = cachedRouteRequest(cache, 'a', load, 0);
  expect(cachedRouteRequest(cache, 'a', load, 1)).toBe(first);
  await Promise.resolve();
  resolve(null);
  await first;
  expect(cache.size).toBe(0);
  await cachedRouteRequest(cache, 'a', async () => ({ distanceMeters: 1, expectedTravelTimeSeconds: 1, points: [] }), 1);
  await cachedRouteRequest(cache, 'b', async () => null, ROUTE_CACHE_TTL_MS + 1);
  expect(cache.size).toBe(0);
});

it('does not retain oversize geometry and enforces a total point budget for varying routes', async () => {
  const cache = new Map<string, RouteCacheEntry>();
  const route = (count: number) => ({ distanceMeters: 1, expectedTravelTimeSeconds: 1,
    points: Array.from({ length: count }, () => ({ latitude: 35, longitude: 139 })) });
  const oversize = route(ROUTE_CACHE_MAX_POINTS + 1);
  expect(await cachedRouteRequest(cache, 'oversize', async () => oversize)).toBe(oversize);
  expect(cache.size).toBe(0);
  for (let i = 0; i < 30; i++) await cachedRouteRequest(cache, String(i), async () => route(5000));
  expect([...cache.values()].reduce((sum, entry) => sum + entry.pointCount, 0)).toBe(20_000);
  expect(cache.size).toBe(4);
});
