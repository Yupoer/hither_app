import type { DirectionsResult } from '../native/maps';

export const ROUTE_CACHE_MAX_ENTRIES = 24;
export const ROUTE_CACHE_MAX_POINTS = 24_000;
export const ROUTE_CACHE_TTL_MS = 5 * 60_000;
export interface RouteCacheEntry {
  request: Promise<DirectionsResult | null>;
  createdAt: number;
  pointCount: number;
}

/** Bound retained route geometry, including in-flight entries, during a long map session. */
export function cachedRouteRequest(
  cache: Map<string, RouteCacheEntry>,
  key: string,
  load: () => Promise<DirectionsResult | null>,
  now: number = Date.now(),
): Promise<DirectionsResult | null> {
  for (const [entryKey, entry] of cache) {
    if (now - entry.createdAt >= ROUTE_CACHE_TTL_MS) cache.delete(entryKey);
  }
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.request;
  }
  const request = Promise.resolve().then(load).catch(() => null).then(route => {
    // An evicted request must not delete its newer replacement on completion.
    if (cache.get(key)?.request === request) {
      if (!route || route.points.length > ROUTE_CACHE_MAX_POINTS) cache.delete(key);
      else {
        cache.get(key)!.pointCount = route.points.length;
        let retainedPoints = [...cache.values()].reduce((sum, entry) => sum + entry.pointCount, 0);
        for (const [entryKey, entry] of cache) {
          if (retainedPoints <= ROUTE_CACHE_MAX_POINTS) break;
          retainedPoints -= entry.pointCount;
          cache.delete(entryKey);
        }
      }
    }
    return route;
  });
  cache.set(key, { request, createdAt: now, pointCount: 0 });
  while (cache.size > ROUTE_CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return request;
}
