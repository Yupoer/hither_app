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
 * Merge a remote group snapshot without allowing the remote copy of the
 * current user's location to move their local map backwards.
 */
export function mergeRemoteGroupStatePreservingOwnLocation(
  previous: GroupState | null,
  remote: GroupState,
  ownUserId?: string | null,
  options: { preserveLocalGathering?: boolean } = {},
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

  if (!options.preserveLocalGathering) return { ...remote, members };

  // A leader transition is local-first. During its brief sync window an old
  // remote snapshot must not replace a complete local itinerary with `{}` or
  // erase the local going/active projection.
  const preserveDestinations =
    previous.destinations.length > 0 && remote.destinations.length === 0;
  const preserveJourney =
    previous.group.journeyStatus !== remote.group.journeyStatus
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
