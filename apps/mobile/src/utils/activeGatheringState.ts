/**
 * OTA-04 local-first active gathering entity (pure).
 *
 * Layering (OTA-01):
 * - `teamGatheringState` is the live map/session projection source of truth.
 * - This module is the offline outbox entity shape used by coreDataStore.
 * - End semantics match server `complete_gathering_stop` and teamGatheringState:
 *   completed point, global `staying`, **activeDestinationId cleared (null)**,
 *   next point remains pending until Start (not auto en_route).
 *
 * Personal progress/nav response must never call these transitions.
 */

import type { Destination, Group, GroupState } from '../types';
import type {
  ActiveGatheringState,
  GatheringPointStatus,
  JourneyPhase,
} from '../types/coreData';

const VALID_POINT_TRANSITIONS: Record<
  GatheringPointStatus,
  readonly GatheringPointStatus[]
> = {
  pending: ['en_route'],
  en_route: ['completed'],
  completed: [],
};

export function pointStatusOf(
  state: ActiveGatheringState,
  destinationId: string,
): GatheringPointStatus {
  return state.pointStatuses[destinationId] ?? 'pending';
}

/** First non-completed destination in insertion order (itinerary order). */
export function nextPendingDestinationId(
  state: ActiveGatheringState,
  afterId?: string | null,
): string | null {
  const ids = Object.keys(state.pointStatuses);
  let start = 0;
  if (afterId) {
    const idx = ids.indexOf(afterId);
    start = idx >= 0 ? idx + 1 : 0;
  }
  for (let i = start; i < ids.length; i++) {
    const id = ids[i]!;
    if (pointStatusOf(state, id) !== 'completed') return id;
  }
  if (afterId != null) return null;
  // Full scan when no cursor: first pending/open.
  for (const id of ids) {
    if (pointStatusOf(state, id) !== 'completed') return id;
  }
  return null;
}

/** Destination Start will target while staying (server-shaped cursor). */
export function resolveStartDestinationId(
  state: ActiveGatheringState,
): string | null {
  if (state.journeyPhase !== 'staying') return null;
  if (
    state.activeDestinationId
    && pointStatusOf(state, state.activeDestinationId) === 'pending'
  ) {
    return state.activeDestinationId;
  }
  // While staying, active id is normally null (server). Fall back to next pending.
  return nextPendingDestinationId(state, null);
}

export function canStartGathering(state: ActiveGatheringState): boolean {
  if (state.journeyPhase !== 'staying') return false;
  const target = resolveStartDestinationId(state);
  return target != null && pointStatusOf(state, target) === 'pending';
}

export function canEndGathering(state: ActiveGatheringState): boolean {
  if (state.journeyPhase !== 'en_route') return false;
  if (!state.activeDestinationId) return false;
  return pointStatusOf(state, state.activeDestinationId) === 'en_route';
}

export function startGathering(
  state: ActiveGatheringState,
  nowMs: number,
): ActiveGatheringState {
  if (!canStartGathering(state)) {
    throw new Error('invalid_transition:start_gathering');
  }
  const destId = resolveStartDestinationId(state);
  if (!destId) {
    throw new Error('invalid_transition:start_gathering');
  }
  return {
    ...state,
    journeyPhase: 'en_route',
    activeDestinationId: destId,
    phaseChangedAt: nowMs,
    entityVersion: state.entityVersion + 1,
    pointStatuses: {
      ...state.pointStatuses,
      [destId]: 'en_route',
    },
  };
}

/**
 * End current en_route point → completed; global staying.
 * Next pending becomes the soft active cursor (still pending until Start) so
 * offline clients and versioned ops preserve itinerary advance.
 * Pass `nextDestinationId: null` to force no next cursor.
 */
export function endGathering(
  state: ActiveGatheringState,
  nowMs: number,
  nextDestinationId?: string | null,
): ActiveGatheringState {
  if (!canEndGathering(state) || !state.activeDestinationId) {
    throw new Error('invalid_transition:end_gathering');
  }
  const completedId = state.activeDestinationId;

  const pointStatuses: Record<string, GatheringPointStatus> = {
    ...state.pointStatuses,
    [completedId]: 'completed',
  };
  const autoNext = nextPendingDestinationId(
    { ...state, pointStatuses },
    completedId,
  );
  // Explicit null clears the cursor; undefined → auto next pending.
  const nextId =
    nextDestinationId === undefined ? autoNext : nextDestinationId;
  if (nextId && !pointStatuses[nextId]) {
    pointStatuses[nextId] = 'pending';
  }

  return {
    ...state,
    journeyPhase: 'staying',
    // Soft cursor for next Start (point remains pending, not en_route).
    activeDestinationId: nextId,
    phaseChangedAt: nowMs,
    entityVersion: state.entityVersion + 1,
    pointStatuses,
  };
}

/** True when a value looks like a usable ActiveGatheringState (not `{}`). */
export function isUsableActiveGatheringState(
  value: unknown,
): value is ActiveGatheringState {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<ActiveGatheringState>;
  return (
    typeof row.groupId === 'string'
    && (row.journeyPhase === 'staying' || row.journeyPhase === 'en_route')
    && typeof row.entityVersion === 'number'
    && row.pointStatuses != null
    && typeof row.pointStatuses === 'object'
  );
}

export function isValidPointTransition(
  from: GatheringPointStatus,
  to: GatheringPointStatus,
): boolean {
  return VALID_POINT_TRANSITIONS[from].includes(to);
}

/**
 * Converge two clients' gathering views: higher entity version wins.
 * Equal versions prefer the more advanced phase/status without inventing
 * transitions (used after ordered and out-of-order remote applies).
 */
export function convergeActiveGathering(
  local: ActiveGatheringState,
  remote: ActiveGatheringState,
): ActiveGatheringState {
  if (local.groupId !== remote.groupId) return remote;
  if (remote.entityVersion > local.entityVersion) return remote;
  if (local.entityVersion > remote.entityVersion) return local;
  // Same version: keep the later phaseChangedAt as tie-break for display.
  if (remote.phaseChangedAt >= local.phaseChangedAt) return remote;
  return local;
}

/** Map legacy going/paused + closed_at into OTA-01 active gathering. */
export function deriveActiveGatheringFromGroup(
  group: Group,
  destinations: Destination[],
  entityVersion = 1,
  nowMs = Date.now(),
): ActiveGatheringState {
  const journeyPhase: JourneyPhase =
    group.journeyStatus === 'going' ? 'en_route' : 'staying';

  // Server-shaped: active id only while en_route. While staying, null —
  // next pending is derived from open itinerary / pointStatuses.
  const activeDestinationId =
    journeyPhase === 'en_route'
      ? (group.activeDestinationId
        ?? destinations.find((d) => !d.closedAt)?.id
        ?? null)
      : null;

  const pointStatuses: Record<string, GatheringPointStatus> = {};
  for (const dest of destinations) {
    if (dest.closedAt) {
      pointStatuses[dest.id] = 'completed';
    } else if (
      journeyPhase === 'en_route'
      && dest.id === activeDestinationId
    ) {
      pointStatuses[dest.id] = 'en_route';
    } else {
      pointStatuses[dest.id] = 'pending';
    }
  }

  const phaseChangedAt = group.journeyStartedAt
    ? Date.parse(group.journeyStartedAt)
    : nowMs;

  return {
    groupId: group.id,
    journeyPhase,
    activeDestinationId,
    pointStatuses,
    phaseChangedAt: Number.isFinite(phaseChangedAt) ? phaseChangedAt : nowMs,
    entityVersion,
  };
}

export function deriveActiveGatheringFromGroupState(
  state: GroupState,
  entityVersion = 1,
  nowMs = Date.now(),
): ActiveGatheringState {
  return deriveActiveGatheringFromGroup(
    state.group,
    state.destinations,
    entityVersion,
    nowMs,
  );
}

/** Project gathering onto legacy Group fields for existing UI. */
export function applyGatheringToGroup(
  group: Group,
  gathering: ActiveGatheringState,
): Group {
  return {
    ...group,
    journeyStatus: gathering.journeyPhase === 'en_route' ? 'going' : 'paused',
    activeDestinationId:
      gathering.journeyPhase === 'en_route'
        ? (gathering.activeDestinationId ?? undefined)
        : undefined,
    journeyStartedAt:
      gathering.journeyPhase === 'en_route'
        ? new Date(gathering.phaseChangedAt).toISOString()
        : undefined,
  };
}

/** Apply completed marks onto itinerary destinations. */
export function applyGatheringToDestinations(
  destinations: Destination[],
  gathering: ActiveGatheringState,
): Destination[] {
  return destinations.map((dest) => {
    const status = pointStatusOf(gathering, dest.id);
    if (status === 'completed') {
      return {
        ...dest,
        closedAt: dest.closedAt ?? new Date(gathering.phaseChangedAt).toISOString(),
      };
    }
    return dest;
  });
}

export function groupStateFromSnapshotParts(
  group: Group,
  destinations: Destination[],
  gathering: ActiveGatheringState,
  members: GroupState['members'] = [],
  subgroups: GroupState['subgroups'] = [],
): GroupState {
  const projectedGroup = applyGatheringToGroup(group, gathering);
  const projectedDestinations = applyGatheringToDestinations(
    destinations,
    gathering,
  );
  const nextPendingId = nextPendingDestinationId(gathering, null);
  const nextDestination =
    projectedDestinations.find((d) => d.id === gathering.activeDestinationId)
    ?? projectedDestinations.find((d) => d.id === nextPendingId)
    ?? projectedDestinations.find((d) => !d.closedAt)
    ?? projectedDestinations[0];
  return {
    group: projectedGroup,
    destinations: projectedDestinations,
    members,
    subgroups,
    nextDestination,
  };
}
