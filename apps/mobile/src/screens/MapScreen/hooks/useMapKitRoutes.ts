import { useEffect, useRef, useState } from 'react';
import type { Coordinates } from '../../../types';
import {
  getDirections,
  type DirectionsResult,
  type TravelMode,
} from '../../../native/maps';

interface RouteMember {
  userId: string;
  coordinates?: Coordinates;
}

interface RouteTarget {
  coordinates: Coordinates;
}

interface MapKitRouteInputs {
  selfCoordinates?: Coordinates;
  members: RouteMember[];
  gathering?: RouteTarget | null;
  travelMode: TravelMode;
}

export interface MapKitRoutesState {
  selfRoute: DirectionsResult | null;
  memberRoutes: Record<string, DirectionsResult>;
  /** BUG-20: self routes for every travel mode while navigating. */
  allModeRoutes: Partial<Record<TravelMode, DirectionsResult>>;
}

type RouteGetter = typeof getDirections;

const ALL_MODES: TravelMode[] = ['walk', 'transit', 'drive'];

export async function loadMapKitRoutes(
  { selfCoordinates, members, gathering, travelMode }: MapKitRouteInputs,
  getRoute: RouteGetter = getDirections,
): Promise<MapKitRoutesState> {
  if (!gathering) {
    return { selfRoute: null, memberRoutes: {}, allModeRoutes: {} };
  }

  const [selfRoute, entries, modeEntries] = await Promise.all([
    selfCoordinates
      ? getRoute(selfCoordinates, gathering.coordinates, travelMode)
      : Promise.resolve(null),
    Promise.all(members.map(async (member) => {
      if (!member.coordinates) return null;
      const route = await getRoute(member.coordinates, gathering.coordinates, travelMode);
      return route ? ([member.userId, route] as const) : null;
    })),
    // BUG-20: precompute walk/transit/drive for self when we have a position.
    selfCoordinates
      ? Promise.all(
          ALL_MODES.map(async (mode) => {
            const route = await getRoute(selfCoordinates, gathering.coordinates, mode);
            return route ? ([mode, route] as const) : null;
          }),
        )
      : Promise.resolve([] as const),
  ]);

  const allModeRoutes: Partial<Record<TravelMode, DirectionsResult>> = {};
  for (const entry of modeEntries) {
    if (entry) allModeRoutes[entry[0]] = entry[1];
  }
  // Prefer the dedicated current-mode result if multi-mode failed for it.
  if (selfRoute) allModeRoutes[travelMode] = selfRoute;

  return {
    selfRoute,
    memberRoutes: Object.fromEntries(entries.filter((entry) => entry !== null)),
    allModeRoutes,
  };
}

function routeKey(from: Coordinates, to: Coordinates, mode: TravelMode): string {
  return [
    mode,
    from.latitude.toFixed(5),
    from.longitude.toFixed(5),
    to.latitude.toFixed(5),
    to.longitude.toFixed(5),
  ].join(':');
}

export function useMapKitRoutes(inputs: MapKitRouteInputs): MapKitRoutesState {
  const { selfCoordinates, members, gathering, travelMode } = inputs;
  const [state, setState] = useState<MapKitRoutesState>({
    selfRoute: null,
    memberRoutes: {},
    allModeRoutes: {},
  });
  // ponytail: cache lives for one MapScreen mount; cap/TTL only if large groups
  // make measured memory or stale-route behavior a problem.
  const cacheRef = useRef(new Map<string, Promise<DirectionsResult | null>>());

  useEffect(() => {
    let active = true;
    const cachedGetRoute: RouteGetter = (from, to, mode) => {
      const key = routeKey(from, to, mode);
      const cached = cacheRef.current.get(key);
      if (cached) return cached;
      const request = getDirections(from, to, mode);
      cacheRef.current.set(key, request);
      return request;
    };

    void loadMapKitRoutes(
      { selfCoordinates, members, gathering, travelMode },
      cachedGetRoute,
    ).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [selfCoordinates, members, gathering, travelMode]);

  return state;
}
