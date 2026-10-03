import { useEffect, useRef, useState } from 'react';
import type { Coordinates } from '../../../types';
import {
  getDirections,
  type DirectionsResult,
  type TravelMode,
} from '../../../native/maps';
import {
  locationPolicy,
  quantizeCoordinates,
  shouldRecomputeRoute,
  type LocationGateState,
} from '../../../utils/locationPolicy';

interface RouteMember {
  userId: string;
  coordinates?: Coordinates;
}

interface RouteTarget {
  id?: string;
  coordinates: Coordinates;
}

interface MapKitRouteInputs {
  selfCoordinates?: Coordinates;
  members: RouteMember[];
  gathering?: RouteTarget | null;
  travelMode: TravelMode;
  highAccuracy?: boolean;
}

export interface MapKitRoutesState {
  selfRoute: DirectionsResult | null;
  memberRoutes: Record<string, DirectionsResult>;
  /**
   * Monotonic id for the latest accepted self directions completion.
   * Bumps even when distance_m equals the previous result so consumers can
   * re-anchor GPS estimates (#145 route-result freshness).
   */
  selfRouteGeneration: number;
}

type RouteGetter = typeof getDirections;

export async function loadMapKitRoutes(
  {
    selfCoordinates,
    members,
    gathering,
    travelMode,
    /** Default false: flock uses haversine ETA; MapKit only for self path. */
    includeMemberRoutes = false,
  }: MapKitRouteInputs & { includeMemberRoutes?: boolean },
  getRoute: RouteGetter = getDirections,
): Promise<MapKitRoutesState> {
  if (!gathering) {
    return { selfRoute: null, memberRoutes: {}, selfRouteGeneration: 0 };
  }

  // Member MapKit directions are N network/native calls per tick — only when
  // explicitly requested (off by default to save radio + CPU).
  const memberList = includeMemberRoutes ? members : [];

  const [selfRoute, entries] = await Promise.all([
    selfCoordinates
      ? getRoute(selfCoordinates, gathering.coordinates, travelMode)
      : Promise.resolve(null),
    Promise.all(
      memberList.map(async (member) => {
        if (!member.coordinates) return null;
        const route = await getRoute(
          member.coordinates,
          gathering.coordinates,
          travelMode,
        );
        return route ? ([member.userId, route] as const) : null;
      }),
    ),
  ]);

  return {
    selfRoute,
    memberRoutes: Object.fromEntries(entries.filter((entry) => entry !== null)),
    selfRouteGeneration: 0,
  };
}

export function routeCacheKey(
  from: Coordinates,
  to: Coordinates,
  mode: TravelMode,
  decimals: number,
): string {
  return [
    mode,
    quantizeCoordinates(from, decimals),
    quantizeCoordinates(to, decimals),
  ].join('|');
}

/** Stable signature of member positions for gate comparison. */
export function membersRouteSignature(
  members: RouteMember[],
  decimals: number,
): string {
  return members
    .map((m) =>
      m.coordinates
        ? `${m.userId}:${quantizeCoordinates(m.coordinates, decimals)}`
        : `${m.userId}:-`,
    )
    .sort()
    .join(';');
}

export function useMapKitRoutes(inputs: MapKitRouteInputs): MapKitRoutesState {
  const {
    selfCoordinates,
    gathering,
    travelMode,
    highAccuracy = false,
  } = inputs;
  // Target identity is exact; origin jitter remains governed by the route gate.
  // Hide old-target geometry during render, before the directions effect runs.
  const targetKey = gathering
    ? [gathering.id ?? '', gathering.coordinates.latitude,
        gathering.coordinates.longitude, travelMode].join('|')
    : '-';
  const [state, setState] = useState<MapKitRoutesState & { targetKey: string }>({
    targetKey,
    selfRoute: null,
    memberRoutes: {},
    selfRouteGeneration: 0,
  });
  // ponytail: cache lives for one MapScreen mount; cap/TTL only if large groups
  // make measured memory or stale-route behavior a problem.
  const cacheRef = useRef(new Map<string, Promise<DirectionsResult | null>>());
  const selfRouteGateRef = useRef<LocationGateState>({
    lastCoords: null,
    lastAtMs: 0,
  });
  const routedSelfRef = useRef<Coordinates | undefined>(undefined);
  const lastEffectKeyRef = useRef<string>('');
  const requestGenerationRef = useRef(0);
  const selfRouteGenerationRef = useRef(0);

  useEffect(() => () => {
    requestGenerationRef.current += 1;
    // StrictMode replays setup after cleanup. Let it re-attach to a cached
    // pending request rather than leaving that request permanently invalid.
    lastEffectKeyRef.current = '';
  }, []);

  useEffect(() => {
    const policy = locationPolicy(highAccuracy);
    const now = Date.now();
    const decimals = policy.routeCoordDecimals;

    // Stabilize self coords: skip tiny GPS jitter for MapKit.
    let routedSelf = routedSelfRef.current;
    if (selfCoordinates) {
      if (
        shouldRecomputeRoute(
          selfCoordinates,
          now,
          selfRouteGateRef.current,
          policy,
        )
      ) {
        selfRouteGateRef.current = {
          lastCoords: selfCoordinates,
          lastAtMs: now,
        };
        routedSelf = selfCoordinates;
        routedSelfRef.current = selfCoordinates;
      } else if (!routedSelf) {
        routedSelf = selfCoordinates;
        routedSelfRef.current = selfCoordinates;
        selfRouteGateRef.current = {
          lastCoords: selfCoordinates,
          lastAtMs: now,
        };
      }
    } else {
      routedSelf = undefined;
      routedSelfRef.current = undefined;
      selfRouteGateRef.current = { lastCoords: null, lastAtMs: 0 };
    }

    // Member positions no longer trigger MapKit (haversine flock ETA) — omit
    // from the effect key so peer GPS pings do not re-hit directions.
    const selfKey = routedSelf
      ? quantizeCoordinates(routedSelf, decimals)
      : '-';
    const effectKey = [
      selfKey,
      targetKey,
      travelMode,
      highAccuracy ? 'h' : 'n',
    ].join('#');

    // Identical quantized inputs: do not re-hit MapKit.
    if (effectKey === lastEffectKeyRef.current) {
      return;
    }
    lastEffectKeyRef.current = effectKey;

    // Only a meaningful request change invalidates the previous completion.
    // Raw GPS/target object rerenders with the same key keep it eligible.
    const requestGeneration = ++requestGenerationRef.current;
    const cachedGetRoute: RouteGetter = (from, to, mode) => {
      // Origin quantization avoids jitter requests; a changed destination must
      // not reuse another stop's geometry even within the same GPS bucket.
      const key = [routeCacheKey(from, to, mode, decimals), to.latitude, to.longitude].join('|');
      const cached = cacheRef.current.get(key);
      if (cached) return cached;
      // Keep successful geometry and in-flight dedupe, but do not permanently
      // cache a null/error produced while offline or while the proxy circuit
      // is open. A later gated coordinate can then be the single half-open
      // recovery probe instead of replaying a stale failure forever.
      const request = (async () => {
        try {
          const route = await getDirections(from, to, mode);
          if (!route) cacheRef.current.delete(key);
          return route;
        } catch {
          cacheRef.current.delete(key);
          return null;
        }
      })();
      cacheRef.current.set(key, request);
      return request;
    };

    // No target → clear polylines (nav stopped / arrived / next stop not set).
    if (!gathering) {
      selfRouteGenerationRef.current += 1;
      setState({
        targetKey,
        selfRoute: null,
        memberRoutes: {},
        selfRouteGeneration: selfRouteGenerationRef.current,
      });
      return;
    }

    void loadMapKitRoutes(
      {
        selfCoordinates: routedSelf,
        members: [],
        gathering,
        travelMode,
        includeMemberRoutes: false,
      },
      cachedGetRoute,
    ).then((next) => {
      if (requestGeneration !== requestGenerationRef.current) return;
      // Fail-closed: empty/failed directions clear the previous polyline so
      // UI falls back to haversine distance + local 估算 ETA (never a stale path).
      // Out-of-order responses are ignored when the request generation changes.
      // Always bump generation so equal-distance results still re-anchor (#145).
      selfRouteGenerationRef.current += 1;
      setState({
        targetKey,
        selfRoute: next.selfRoute,
        memberRoutes: next.memberRoutes,
        selfRouteGeneration: selfRouteGenerationRef.current,
      });
    });
  }, [
    selfCoordinates,
    gathering,
    travelMode,
    highAccuracy,
    targetKey,
  ]);

  if (state.targetKey !== targetKey) {
    return {
      selfRoute: null,
      memberRoutes: {},
      selfRouteGeneration: state.selfRouteGeneration,
    };
  }
  return state;
}
