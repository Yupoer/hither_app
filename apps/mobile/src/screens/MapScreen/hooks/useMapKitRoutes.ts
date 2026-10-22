import { createElement, useState, type ReactElement } from 'react';
import { useMountEffect } from '../../../hooks/useMountEffect';
import type { Coordinates } from '../../../types';
import { cachedRouteRequest, type RouteCacheEntry } from '../../../utils/routeRequestCache';
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

export function useMapKitRoutes(inputs: MapKitRouteInputs): MapKitRoutesState & { lifecycle: ReactElement } {
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
  const [owner] = useState<MapKitRouteOwner>(() => ({
    cache: new Map(), selfRouteGate: { lastCoords: null, lastAtMs: 0 },
    routedSelf: undefined, lastEffectKey: '', requestGeneration: 0,
    selfRouteGeneration: 0, setState,
  }));
  const lifecycle = createElement(MapKitRouteLifecycle, { owner,
    selfCoordinates, gathering, travelMode, highAccuracy, targetKey });
  if (state.targetKey !== targetKey) {
    return { selfRoute: null, memberRoutes: {},
      selfRouteGeneration: state.selfRouteGeneration, lifecycle };
  }
  return { ...state, lifecycle };
}

type CommittedRouteInput = Pick<MapKitRouteInputs,
  'selfCoordinates' | 'gathering' | 'travelMode'> & {
  highAccuracy: boolean; targetKey: string; generation: number;
};
interface MapKitRouteOwner {
  cache: Map<string, RouteCacheEntry>;
  selfRouteGate: LocationGateState;
  routedSelf: Coordinates | undefined;
  lastEffectKey: string;
  requestGeneration: number;
  selfRouteGeneration: number;
  setState: (state: MapKitRoutesState & { targetKey: string }) => void;
}

function MapKitRouteLifecycle({ owner, selfCoordinates, gathering, travelMode, highAccuracy, targetKey }: {
  owner: MapKitRouteOwner;
} & Omit<CommittedRouteInput, 'generation'>): ReactElement {
  const [routeInput, setRouteInput] = useState(() => ({
    selfCoordinates, gathering, travelMode, highAccuracy, targetKey, generation: 0,
  }));
  if (!Object.is(routeInput.selfCoordinates, selfCoordinates)
    || !Object.is(routeInput.gathering, gathering)
    || !Object.is(routeInput.travelMode, travelMode)
    || !Object.is(routeInput.highAccuracy, highAccuracy)
    || !Object.is(routeInput.targetKey, targetKey)) {
    setRouteInput({ selfCoordinates, gathering, travelMode, highAccuracy, targetKey,
      generation: routeInput.generation + 1 });
  }
  useMountEffect(() => () => {
    owner.requestGeneration += 1;
    // Strict replay reattaches to the cached pending request after invalidation.
    owner.lastEffectKey = '';
  });
  return createElement(MapKitRouteRequest, { key: routeInput.generation, owner, input: routeInput });
}

/** Reevaluation owns no cancellation. Only a meaningful route key supersedes a request. */
function MapKitRouteRequest({ owner, input }: {
  owner: MapKitRouteOwner; input: CommittedRouteInput;
}): null {
  useMountEffect(() => {
    const { selfCoordinates, gathering, travelMode, highAccuracy, targetKey } = input;
    const policy = locationPolicy(highAccuracy);
    const now = Date.now();
    const decimals = policy.routeCoordDecimals;

    // Stabilize self coords: skip tiny GPS jitter for MapKit.
    let routedSelf = owner.routedSelf;
    if (selfCoordinates) {
      if (
        shouldRecomputeRoute(
          selfCoordinates,
          now,
          owner.selfRouteGate,
          policy,
        )
      ) {
        owner.selfRouteGate = {
          lastCoords: selfCoordinates,
          lastAtMs: now,
        };
        routedSelf = selfCoordinates;
        owner.routedSelf = selfCoordinates;
      } else if (!routedSelf) {
        routedSelf = selfCoordinates;
        owner.routedSelf = selfCoordinates;
        owner.selfRouteGate = {
          lastCoords: selfCoordinates,
          lastAtMs: now,
        };
      }
    } else {
      routedSelf = undefined;
      owner.routedSelf = undefined;
      owner.selfRouteGate = { lastCoords: null, lastAtMs: 0 };
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
    if (effectKey === owner.lastEffectKey) {
      return;
    }
    owner.lastEffectKey = effectKey;

    // Only a meaningful request change invalidates the previous completion.
    // Raw GPS/target object rerenders with the same key keep it eligible.
    const requestGeneration = ++owner.requestGeneration;
    const cachedGetRoute: RouteGetter = (from, to, mode) => {
      // Origin quantization avoids jitter requests; a changed destination must
      // not reuse another stop's geometry even within the same GPS bucket.
      const key = [routeCacheKey(from, to, mode, decimals), to.latitude, to.longitude].join('|');
      return cachedRouteRequest(owner.cache, key, () => getDirections(from, to, mode));
    };

    // No target → clear polylines (nav stopped / arrived / next stop not set).
    if (!gathering) {
      owner.selfRouteGeneration += 1;
      owner.setState({
        targetKey,
        selfRoute: null,
        memberRoutes: {},
        selfRouteGeneration: owner.selfRouteGeneration,
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
      if (requestGeneration !== owner.requestGeneration) return;
      // Fail-closed: empty/failed directions clear the previous polyline so
      // UI falls back to haversine distance + local 估算 ETA (never a stale path).
      // Out-of-order responses are ignored when the request generation changes.
      // Always bump generation so equal-distance results still re-anchor (#145).
      owner.selfRouteGeneration += 1;
      owner.setState({
        targetKey,
        selfRoute: next.selfRoute,
        memberRoutes: next.memberRoutes,
        selfRouteGeneration: owner.selfRouteGeneration,
      });
    });
  });
  return null;
}
