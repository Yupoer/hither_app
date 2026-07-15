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
  coordinates: Coordinates;
}

interface MapKitRouteInputs {
  selfCoordinates?: Coordinates;
  members: RouteMember[];
  gathering?: RouteTarget | null;
  travelMode: TravelMode;
  /** When false, skip alternate-mode precompute (walk/transit/drive). */
  journeyActive?: boolean;
  highAccuracy?: boolean;
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
  {
    selfCoordinates,
    members,
    gathering,
    travelMode,
    journeyActive = false,
    /** Default false: flock uses haversine ETA; MapKit only for self path. */
    includeMemberRoutes = false,
  }: MapKitRouteInputs & { includeMemberRoutes?: boolean },
  getRoute: RouteGetter = getDirections,
): Promise<MapKitRoutesState> {
  if (!gathering) {
    return { selfRoute: null, memberRoutes: {}, allModeRoutes: {} };
  }

  const wantAllModes = journeyActive && !!selfCoordinates;
  // Member MapKit directions are N network/native calls per tick — only when
  // explicitly requested (off by default to save radio + CPU).
  const memberList = includeMemberRoutes ? members : [];

  const [selfRoute, entries, modeEntries] = await Promise.all([
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
    // Only precompute alternate modes while actively navigating.
    wantAllModes
      ? Promise.all(
          ALL_MODES.map(async (mode) => {
            const route = await getRoute(
              selfCoordinates!,
              gathering.coordinates,
              mode,
            );
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
    members,
    gathering,
    travelMode,
    journeyActive = false,
    highAccuracy = false,
  } = inputs;
  const [state, setState] = useState<MapKitRoutesState>({
    selfRoute: null,
    memberRoutes: {},
    allModeRoutes: {},
  });
  // ponytail: cache lives for one MapScreen mount; cap/TTL only if large groups
  // make measured memory or stale-route behavior a problem.
  const cacheRef = useRef(new Map<string, Promise<DirectionsResult | null>>());
  const selfRouteGateRef = useRef<LocationGateState>({
    lastCoords: null,
    lastAtMs: 0,
  });
  const routedSelfRef = useRef<Coordinates | undefined>(undefined);
  const lastMembersSigRef = useRef<string>('');
  const lastEffectKeyRef = useRef<string>('');

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
    const gatheringKey = gathering
      ? quantizeCoordinates(gathering.coordinates, decimals)
      : '-';
    const selfKey = routedSelf
      ? quantizeCoordinates(routedSelf, decimals)
      : '-';
    const effectKey = [
      selfKey,
      gatheringKey,
      travelMode,
      journeyActive ? '1' : '0',
      highAccuracy ? 'h' : 'n',
    ].join('#');

    // Identical quantized inputs: do not re-hit MapKit.
    if (effectKey === lastEffectKeyRef.current) {
      return;
    }
    lastEffectKeyRef.current = effectKey;
    lastMembersSigRef.current = '';

    let active = true;
    const cachedGetRoute: RouteGetter = (from, to, mode) => {
      const key = routeCacheKey(from, to, mode, decimals);
      const cached = cacheRef.current.get(key);
      if (cached) return cached;
      const request = getDirections(from, to, mode);
      cacheRef.current.set(key, request);
      return request;
    };

    // No target → clear polylines (nav stopped / arrived / next stop not set).
    if (!gathering) {
      setState({ selfRoute: null, memberRoutes: {}, allModeRoutes: {} });
      return () => {
        active = false;
      };
    }

    void loadMapKitRoutes(
      {
        selfCoordinates: routedSelf,
        members: [],
        gathering,
        travelMode,
        journeyActive,
        includeMemberRoutes: false,
      },
      cachedGetRoute,
    ).then((next) => {
      if (!active) return;
      // Keep last good self route when a recompute returns null — dropping to
      // straight-line mid-journey inflates Live Activity progress falsely.
      // Only sticky while we still have a gathering target.
      setState((prev) => ({
        ...next,
        selfRoute: next.selfRoute ?? prev.selfRoute,
        allModeRoutes: {
          ...next.allModeRoutes,
          ...(next.selfRoute || !prev.selfRoute
            ? {}
            : { [travelMode]: prev.allModeRoutes[travelMode] ?? prev.selfRoute }),
        },
      }));
    });
    return () => {
      active = false;
    };
  }, [
    selfCoordinates,
    gathering,
    travelMode,
    journeyActive,
    highAccuracy,
  ]);

  return state;
}
