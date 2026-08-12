import type { GroupState, MemberLocation } from '../types';

/**
 * Synchronisation precedence used by the map data surfaces.
 *
 * - Own GPS is owned by the device and is never replaced by a remote row.
 * - Peer GPS is owned by Realtime/remote reload and may replace local cache.
 * - Team gathering/itinerary mutations are owned by the leader's local
 *   optimistic outbox first, then server acknowledgement, then follower cache.
 * - Member requests are local intent first, server ledger second, leader view
 *   last; this helper only handles the location projection.
 */
export const SYNC_AUTHORITY = {
  ownLocation: ['local', 'server'] as const,
  peerLocation: ['server', 'local_cache'] as const,
  leaderGathering: ['leader_local', 'server', 'follower_local'] as const,
  gatheringRequest: ['member_local', 'server', 'leader_view'] as const,
  offlineProgress: ['own_local_location', 'local_waypoint'] as const,
} as const;

/**
 * Why a group recovery snapshot is being loaded. Membership events are not
 * itinerary-authoritative: an empty remote itinerary after a join/leave must
 * not wipe a non-empty local card list. Itinerary mutations / poll may clear.
 */
export type GroupReloadReason =
  | 'membership_change'
  | 'itinerary_mutation'
  | 'profile_update'
  | 'subscription_hydrate'
  | 'poll_manual_refresh'
  | 'location_change'
  | 'group_update'
  | 'accommodation_change'
  | 'unknown';

/** Higher number wins when multiple Realtime events coalesce into one load. */
export const GROUP_RELOAD_REASON_PRIORITY: Record<GroupReloadReason, number> = {
  itinerary_mutation: 100,
  accommodation_change: 90,
  group_update: 80,
  membership_change: 50,
  location_change: 40,
  profile_update: 30,
  subscription_hydrate: 20,
  poll_manual_refresh: 10,
  unknown: 0,
};

export function pickStrongerReloadReason(
  current: GroupReloadReason | null | undefined,
  incoming: GroupReloadReason,
): GroupReloadReason {
  if (!current) return incoming;
  return GROUP_RELOAD_REASON_PRIORITY[incoming] >= GROUP_RELOAD_REASON_PRIORITY[current]
    ? incoming
    : current;
}

/**
 * Membership-only empty remote itinerary is non-destructive when local cards
 * already exist. Real deletes arrive as itinerary_mutation (or later poll).
 */
export function shouldFenceEmptyItinerary(input: {
  reason?: GroupReloadReason | null;
  previousDestinationCount: number;
  remoteDestinationCount: number;
}): boolean {
  if (input.remoteDestinationCount > 0) return false;
  if (input.previousDestinationCount <= 0) return false;
  return input.reason === 'membership_change';
}

export type RecoveryMergeOutcome =
  | 'applied'
  | 'fenced_empty_itinerary'
  | 'preserved_local_gathering';

/** Compact diagnostics for membership vs itinerary reload seams (no full payload). */
export function describeRecoveryMerge(input: {
  reason?: GroupReloadReason | null;
  revision: string;
  previousDestinationCount: number;
  remoteDestinationCount: number;
  preserveLocalGathering?: boolean;
  fencedEmptyItinerary?: boolean;
}): {
  reason: GroupReloadReason;
  revision: string;
  localItineraryCount: number;
  remoteItineraryCount: number;
  outcome: RecoveryMergeOutcome;
} {
  const reason = input.reason ?? 'unknown';
  const fenced = input.fencedEmptyItinerary
    ?? shouldFenceEmptyItinerary({
      reason,
      previousDestinationCount: input.previousDestinationCount,
      remoteDestinationCount: input.remoteDestinationCount,
    });
  let outcome: RecoveryMergeOutcome = 'applied';
  if (fenced) outcome = 'fenced_empty_itinerary';
  else if (
    input.preserveLocalGathering
    && input.previousDestinationCount > 0
    && input.remoteDestinationCount === 0
  ) {
    outcome = 'preserved_local_gathering';
  }
  return {
    reason,
    revision: input.revision,
    localItineraryCount: input.previousDestinationCount,
    remoteItineraryCount: input.remoteDestinationCount,
    outcome,
  };
}

export interface MergeRemoteGroupOptions {
  preserveLocalGathering?: boolean;
  /** Trigger that caused this recovery load. */
  reloadReason?: GroupReloadReason | null;
}

/**
 * Merge a remote group snapshot without allowing the remote copy of the
 * current user's location to move their local map backwards.
 */
export function mergeRemoteGroupStatePreservingOwnLocation(
  previous: GroupState | null,
  remote: GroupState,
  ownUserId?: string | null,
  options: MergeRemoteGroupOptions = {},
): GroupState {
  if (!previous) return remote;
  const previousSelf = ownUserId
    ? previous.members.find((member) => member.userId === ownUserId)
    : undefined;
  const members = previousSelf?.coordinates
    ? remote.members.map((member) =>
        member.userId === ownUserId
          ? preserveOwnLocation(member, previousSelf)
          : member,
      )
    : remote.members;

  const fenceEmptyItinerary = shouldFenceEmptyItinerary({
    reason: options.reloadReason,
    previousDestinationCount: previous.destinations.length,
    remoteDestinationCount: remote.destinations.length,
  });

  // Leader transition is local-first. Membership-only empty snapshots must not
  // wipe non-empty cards either (#167).
  const preserveDestinations =
    (options.preserveLocalGathering || fenceEmptyItinerary)
    && previous.destinations.length > 0
    && remote.destinations.length === 0;

  if (!options.preserveLocalGathering && !fenceEmptyItinerary) {
    return { ...remote, members };
  }

  if (!preserveDestinations && !options.preserveLocalGathering) {
    return { ...remote, members };
  }

  // A leader transition is local-first. During its brief sync window an old
  // remote snapshot must not replace a complete local itinerary with `{}` or
  // erase the local going/active projection.
  const preserveJourney =
    options.preserveLocalGathering
    && previous.group.journeyStatus !== remote.group.journeyStatus
    && (previous.group.journeyStatus === 'going' || preserveDestinations);
  return {
    ...remote,
    members,
    destinations: preserveDestinations ? previous.destinations : remote.destinations,
    nextDestination: preserveDestinations
      ? previous.nextDestination
      : remote.nextDestination,
    group: preserveJourney
      ? {
          ...remote.group,
          journeyStatus: previous.group.journeyStatus,
          activeDestinationId: previous.group.activeDestinationId,
          journeyStartedAt: previous.group.journeyStartedAt,
        }
      : remote.group,
  };
}

/** Whether an outbox row represents a leader-owned local gathering intent. */
export function isLeaderGatheringOperation(operation: {
  entityType: string;
  status: string;
}): boolean {
  return operation.entityType === 'active_gathering'
    && ['pending', 'failed', 'inflight', 'conflict'].includes(operation.status);
}


function preserveOwnLocation(
  remote: MemberLocation,
  local: MemberLocation,
): MemberLocation {
  return {
    ...remote,
    coordinates: local.coordinates,
    lastUpdated: local.lastUpdated,
  };
}
