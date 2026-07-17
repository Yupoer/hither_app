import type {
  Coordinates,
  Destination,
  GroupState,
  JourneyStatus,
  PendingInvite,
  Subgroup,
} from '../types';

/**
 * Local demo flock for testing the leader flow without rounding up real
 * people: four members, no gathering points, entirely in-memory — no Supabase
 * rows, no network. `api/client` short-circuits into these helpers whenever
 * the DEMO_GROUP_ID is passed, so every screen behaves exactly as with a real
 * group (add stops, start the journey, watch ETAs) and state resets on app
 * reload. Entry point: the __DEV__ button on the role-select screen.
 */

/** Fixed demo group id — a valid UUID so realtime filters parse harmlessly. */
export const DEMO_GROUP_ID = '00000000-0000-4000-8000-000000000001';

export function isDemoGroup(groupId: string | null | undefined): boolean {
  return groupId === DEMO_GROUP_ID;
}

/** 台北車站 — the demo flock's home turf. */
const BASE: Coordinates = { latitude: 25.0478, longitude: 121.517 };

const state: GroupState = {
  group: {
    id: DEMO_GROUP_ID,
    name: '測試羊群',
    inviteCode: 'DEMO42',
    createdBy: 'demo-me',
    createdAt: new Date().toISOString(),
    journeyStatus: 'paused',
    stragglerAlerts: true,
    stragglerThresholdM: 500,
  },
  members: [
    { userId: 'demo-me', name: '我', role: 'leader', status: 'active', coordinates: BASE },
    {
      userId: 'demo-user-2',
      name: '小羊',
      role: 'follower',
      status: 'active',
      avatar: '🐑',
      coordinates: { latitude: BASE.latitude + 0.0021, longitude: BASE.longitude + 0.0014 },
    },
    {
      userId: 'demo-user-3',
      name: '阿福',
      role: 'follower',
      status: 'active',
      avatar: '🦊',
      coordinates: { latitude: BASE.latitude - 0.0017, longitude: BASE.longitude + 0.0026 },
    },
    {
      userId: 'demo-user-4',
      name: '奇奇',
      role: 'follower',
      status: 'active',
      avatar: '🐰',
      coordinates: { latitude: BASE.latitude + 0.0009, longitude: BASE.longitude - 0.0022 },
    },
  ],
  destinations: [],
  subgroups: [],
  nextDestination: undefined,
};

let destSeq = 0;
let subgroupSeq = 0;

/**
 * Snapshot of the demo state. When the real session user is known, the "me"
 * member takes their id / nickname / avatar so own-pin styling, "· you"
 * labels and the profile editor all line up.
 */
export function getDemoState(
  uid?: string | null,
  nickname?: string | null,
  avatar?: string | null,
): GroupState {
  const members = state.members.map((m, i) =>
    i === 0 && uid
      ? { ...m, userId: uid, name: nickname || m.name, avatar: avatar ?? undefined }
      : m,
  );
  const destinations = state.destinations.map((d) => ({ ...d }));
  return {
    group: { ...state.group },
    members,
    destinations,
    subgroups: state.subgroups.map((s) => ({ ...s })),
    nextDestination: destinations[0],
  };
}

let rehomed = false;

export function demoUpdateMyLocation(coordinates: Coordinates): void {
  // The flock is authored around 台北車站; on the first real GPS fix, shift
  // everyone by the same delta so the demo mates are visible wherever the
  // tester actually is.
  if (!rehomed) {
    rehomed = true;
    const dLat = coordinates.latitude - BASE.latitude;
    const dLng = coordinates.longitude - BASE.longitude;
    state.members = state.members.map((m, i) =>
      i === 0 || !m.coordinates
        ? m
        : {
            ...m,
            coordinates: {
              latitude: m.coordinates.latitude + dLat,
              longitude: m.coordinates.longitude + dLng,
            },
          },
    );
  }
  state.members[0] = {
    ...state.members[0],
    coordinates,
    lastUpdated: new Date().toISOString(),
  };
}

export function demoAddDestination(input: {
  title: string;
  address?: string;
  coordinates: Coordinates;
  day?: number;
  /** Scope stop to a 小隊; omit/undefined = main team itinerary. */
  subgroupId?: string;
}): void {
  const targetDay = Math.max(1, input.day ?? 1);
  const scoped = state.destinations.filter((d) =>
    input.subgroupId ? d.subgroupId === input.subgroupId : d.subgroupId == null,
  );
  const sameDay = scoped.filter((d) => (d.day || 1) === targetDay);
  let insertOrder: number;
  if (sameDay.length > 0) {
    insertOrder = Math.max(...sameDay.map((d) => d.order)) + 1;
  } else {
    const earlier = scoped.filter((d) => (d.day || 1) < targetDay);
    insertOrder =
      earlier.length > 0 ? Math.max(...earlier.map((d) => d.order)) + 1 : 0;
  }
  state.destinations = state.destinations.map((d) => {
    if (input.subgroupId ? d.subgroupId !== input.subgroupId : d.subgroupId != null) {
      return d;
    }
    return d.order >= insertOrder ? { ...d, order: d.order + 1 } : d;
  });
  state.destinations.push({
    id: `demo-dest-${++destSeq}`,
    title: input.title,
    address: input.address,
    coordinates: input.coordinates,
    order: insertOrder,
    day: targetDay,
    subgroupId: input.subgroupId,
  } as Destination);
}

export function demoDeleteDestination(destinationId: string): void {
  state.destinations = state.destinations
    .filter((d) => d.id !== destinationId)
    .map((d, i) => ({ ...d, order: i }));
}

export function demoReorderDestinations(orderedIds: string[]): void {
  const byId = new Map(state.destinations.map((d) => [d.id, d]));
  state.destinations = orderedIds
    .map((id) => byId.get(id))
    .filter((d): d is Destination => !!d)
    .map((d, i) => ({ ...d, order: i }));
}

export function demoSetJourneyStatus(status: JourneyStatus): void {
  state.group = { ...state.group, journeyStatus: status };
}

export function demoSetJourneyTarget(destinationId: string | null): void {
  const nextTargetId = destinationId ?? undefined;
  const targetChanged = state.group.activeDestinationId !== nextTargetId;
  state.group = {
    ...state.group,
    journeyStatus: destinationId ? 'going' : 'paused',
    activeDestinationId: nextTargetId,
    journeyStartedAt: destinationId ? new Date().toISOString() : undefined,
  };
  if (targetChanged) {
    state.members = state.members.map((member) =>
      member.status === 'arrived' ? { ...member, status: 'active' } : member,
    );
  }
}

export function demoSetSolo(solo: boolean): void {
  state.members[0] = { ...state.members[0], solo };
}

/** Demo "me" always sits at state.members[0] — see getDemoState. */
export function demoSelfSplit(name: string): Subgroup {
  const me = state.members[0];
  const sg: Subgroup = {
    id: `demo-sg-${++subgroupSeq}`,
    name,
    mode: 'collab',
    leaderId: undefined,
    parentId: me.subgroupId,
  };
  state.subgroups.push(sg);
  state.members[0] = { ...me, subgroupId: sg.id };
  return sg;
}

// Pending join-requests awaiting MY approval. There's no second device in the
// demo flock, so inviting a mate simulates them "requesting to join" — a
// pending card the tester approves/declines, exercising the real approve flow.
let invSeq = 0;
let demoPending: PendingInvite[] = [];

/**
 * Invite a demo mate into a demo subgroup. Instead of a silent auto-join, this
 * simulates the invitee responding: it raises a pending "wants to join your
 * team" request (kind: 'request') that the tester approves in the flock list.
 */
export function demoInviteToSubgroup(subgroupId: string, inviteeId: string): void {
  const member = state.members.find((m) => m.userId === inviteeId);
  const sg = state.subgroups.find((s) => s.id === subgroupId);
  if (!member || !sg) return;
  if (demoPending.some((p) => p.subgroupId === subgroupId && p.inviterId === inviteeId)) return;
  demoPending.push({
    id: `demo-inv-${++invSeq}`,
    groupId: DEMO_GROUP_ID,
    subgroupId,
    inviterId: inviteeId, // the mate requesting to join
    inviteeId: state.members[0].userId, // me, the approver
    status: 'pending',
    subgroupName: sg.name,
    inviterName: member.name,
    kind: 'request',
  });
}

/** Approve a pending demo join-request: move the requester into the team. */
export function demoAcceptSubgroupInvite(inviteId: string): void {
  const p = demoPending.find((x) => x.id === inviteId);
  if (!p) return;
  state.members = state.members.map((m) =>
    m.userId === p.inviterId ? { ...m, subgroupId: p.subgroupId } : m,
  );
  demoPending = demoPending.filter((x) => x.id !== inviteId);
}

/** Decline a pending demo join-request (drop it; membership untouched). */
export function demoDeclineSubgroupInvite(inviteId: string): void {
  demoPending = demoPending.filter((x) => x.id !== inviteId);
}

/** The demo join-requests awaiting my approval. */
export function demoFetchMyInvites(_userId: string): PendingInvite[] {
  return demoPending.map((p) => ({ ...p }));
}

export function demoSelfMerge(): void {
  const me = state.members[0];
  if (!me.subgroupId) return;
  const leavingId = me.subgroupId;
  const sg = state.subgroups.find((s) => s.id === leavingId);
  state.members[0] = { ...me, subgroupId: sg?.parentId };
  const stillOccupied = state.members.some((m) => m.subgroupId === leavingId);
  const hasChildren = state.subgroups.some((s) => s.parentId === leavingId);
  if (!stillOccupied && !hasChildren) {
    // Last person out: drop the empty team, its itinerary, and dangling invites
    // so the members sheet no longer shows "0 人" and orphan stops.
    state.subgroups = state.subgroups.filter((s) => s.id !== leavingId);
    state.destinations = state.destinations
      .filter((d) => d.subgroupId !== leavingId)
      .map((d, i) => ({ ...d, order: i }));
    demoPending = demoPending.filter((p) => p.subgroupId !== leavingId);
  }
}
