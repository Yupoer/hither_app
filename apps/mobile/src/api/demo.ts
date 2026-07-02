import type {
  Coordinates,
  Destination,
  GroupState,
  JourneyStatus,
  Subgroup,
  SubgroupMode,
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
  },
  members: [
    { userId: 'demo-me', name: '我', role: 'leader', coordinates: BASE },
    {
      userId: 'demo-user-2',
      name: '小羊',
      role: 'follower',
      avatar: '🐑',
      coordinates: { latitude: BASE.latitude + 0.0021, longitude: BASE.longitude + 0.0014 },
    },
    {
      userId: 'demo-user-3',
      name: '阿福',
      role: 'follower',
      avatar: '🦊',
      coordinates: { latitude: BASE.latitude - 0.0017, longitude: BASE.longitude + 0.0026 },
    },
    {
      userId: 'demo-user-4',
      name: '奇奇',
      role: 'follower',
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

export function demoUpdateMyLocation(coordinates: Coordinates): void {
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
}): void {
  state.destinations.push({
    id: `demo-dest-${++destSeq}`,
    title: input.title,
    address: input.address,
    coordinates: input.coordinates,
    order: state.destinations.length,
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

export function demoSetSolo(solo: boolean): void {
  state.members[0] = { ...state.members[0], solo };
}

export function demoCreateSubgroup(input: {
  name: string;
  mode: SubgroupMode;
  leaderId?: string;
  parentId?: string;
  memberIds: string[];
}): void {
  const sg: Subgroup = {
    id: `demo-sg-${++subgroupSeq}`,
    name: input.name,
    mode: input.mode,
    leaderId: input.mode === 'led' ? input.leaderId : undefined,
    parentId: input.parentId,
  };
  state.subgroups.push(sg);
  state.members = state.members.map((m) =>
    input.memberIds.includes(m.userId) ? { ...m, subgroupId: sg.id } : m,
  );
}

export function demoMergeSubgroup(subgroupId: string): void {
  const sg = state.subgroups.find((s) => s.id === subgroupId);
  if (!sg) return;
  state.members = state.members.map((m) =>
    m.subgroupId === subgroupId ? { ...m, subgroupId: sg.parentId } : m,
  );
  state.subgroups = state.subgroups.filter((s) => s.id !== subgroupId);
}

/** Demo "me" always sits at state.members[0] — see getDemoState. */
export function demoSelfSplit(name: string): Subgroup {
  const me = state.members[0];
  const sg: Subgroup = {
    id: `demo-sg-${++subgroupSeq}`,
    name,
    mode: 'led',
    leaderId: me.userId,
    parentId: me.subgroupId,
  };
  state.subgroups.push(sg);
  state.members[0] = { ...me, subgroupId: sg.id };
  return sg;
}

export function demoSelfMerge(): void {
  const me = state.members[0];
  if (!me.subgroupId) return;
  const sg = state.subgroups.find((s) => s.id === me.subgroupId);
  state.members[0] = { ...me, subgroupId: sg?.parentId };
  const stillOccupied = state.members.some((m) => m.subgroupId === me.subgroupId);
  const hasChildren = state.subgroups.some((s) => s.parentId === me.subgroupId);
  if (!stillOccupied && !hasChildren) {
    state.subgroups = state.subgroups.filter((s) => s.id !== me.subgroupId);
  }
}
