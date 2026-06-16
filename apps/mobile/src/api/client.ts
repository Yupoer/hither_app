import type {
  Coordinates,
  Destination,
  Group,
  GroupState,
  MemberLocation,
} from '../types';

/**
 * API client for the Hither backend.
 *
 * Phase 4 status: still MOCK. These functions return fabricated data so the
 * app and tests run end-to-end without a live server. Member positions drift
 * slowly over time so the Map screen's 5-second polling shows visible motion
 * on a real device. Each function maps to a real endpoint in the Vapor API
 * (hither_api/Sources/hither_api/routes.swift):
 *
 *   createGroup           -> POST   /groups
 *   joinGroup             -> POST   /groups/join
 *   getGroupState         -> GET    /groups/:groupID   (GroupDetailResponse)
 *   updateNextDestination -> PUT    /groups/:groupID/itineraries/order
 *   updateMyLocation      -> PUT    /me/location
 *
 * Swapping in real HTTP later only touches this file: keep the signatures,
 * replace the bodies with fetch() calls carrying the JWT.
 */

// --- Mock data -------------------------------------------------------------

const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // matches the API's set

/** Base positions; followers orbit these so polling shows movement. */
const MEMBER_SEEDS: Array<
  Omit<MemberLocation, 'coordinates' | 'lastUpdated'> & {
    base: Coordinates;
    /** Orbit radius in degrees (~ tens of metres). 0 = stationary. */
    drift: number;
  }
> = [
  {
    userId: 'u_leader',
    name: '隊長小燈籠',
    role: 'leader',
    status: 'active',
    base: { latitude: 25.0418, longitude: 121.5654 },
    drift: 0,
  },
  {
    userId: 'u_follower_1',
    name: '迷路的貓',
    role: 'follower',
    status: 'active',
    base: { latitude: 25.0421, longitude: 121.5661 },
    drift: 0.0004,
  },
  {
    userId: 'u_follower_2',
    name: '愛拍照的熊',
    role: 'follower',
    status: 'idle',
    base: { latitude: 25.0409, longitude: 121.5648 },
    drift: 0.00025,
  },
];

const MOCK_DESTINATIONS: Destination[] = [
  {
    id: 'dest_1',
    title: '集合點：捷運站 2 號出口',
    description: '出站後右轉，靠牆等候',
    order: 0,
    address: '台北市信義區',
    coordinates: { latitude: 25.041, longitude: 121.565 },
    travelDistance: 0,
    travelTime: 0,
  },
  {
    id: 'dest_2',
    title: '午餐：城隍廟肉圓',
    order: 1,
    address: '新竹市北區中山路',
    coordinates: { latitude: 25.0405, longitude: 121.5668 },
    travelDistance: 1200,
    travelTime: 900,
  },
];

/** Move each member a little based on the current time, so polling animates. */
function liveMembers(now: number): MemberLocation[] {
  const phase = (now / 1000) % (Math.PI * 2 * 30); // slow loop
  return MEMBER_SEEDS.map((seed, i) => {
    const angle = phase + i;
    return {
      userId: seed.userId,
      name: seed.name,
      role: seed.role,
      status: seed.status,
      coordinates: {
        latitude: seed.base.latitude + Math.sin(angle) * seed.drift,
        longitude: seed.base.longitude + Math.cos(angle) * seed.drift,
      },
      lastUpdated: new Date(now).toISOString(),
    };
  });
}

function randomInviteCode(): string {
  return Array.from(
    { length: 6 },
    () =>
      INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)],
  ).join('');
}

function mockGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 'grp_mock',
    name: 'Hither 測試團',
    inviteCode: 'ABC234',
    createdBy: 'u_leader',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockGroupState(group: Group): GroupState {
  return {
    group,
    members: liveMembers(Date.now()),
    destinations: MOCK_DESTINATIONS,
    nextDestination: MOCK_DESTINATIONS[0],
  };
}

/** Simulate a little network latency so loading states are exercised. */
function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// --- Mock API functions ----------------------------------------------------

/** Create a new group (POST /groups). Returns the created group. */
export async function createGroup(name: string): Promise<Group> {
  const id = `grp_${Math.random().toString(36).slice(2, 8)}`;
  return delay(mockGroup({ id, name, inviteCode: randomInviteCode() }));
}

/** Join a group using its 6-char invite code (POST /groups/join). */
export async function joinGroup(inviteCode: string): Promise<Group> {
  const code = inviteCode.toUpperCase();
  return delay(mockGroup({ id: `grp_${code.toLowerCase()}`, inviteCode: code }));
}

/**
 * Fetch the aggregated state for a group (GET /groups/:groupID).
 * Combines group info, members, and the itinerary/destinations.
 */
export async function getGroupState(groupId: string): Promise<GroupState> {
  return mockGroupState(mockGroup({ id: groupId }));
}

/**
 * Set the group's next destination by id and return the refreshed state.
 * Backed by the itinerary-order endpoint
 * (PUT /groups/:groupID/itineraries/order).
 */
export async function updateNextDestination(
  groupId: string,
  destinationId: string,
): Promise<GroupState> {
  const state = mockGroupState(mockGroup({ id: groupId }));
  const next = state.destinations.find((d) => d.id === destinationId);
  return { ...state, nextDestination: next ?? state.nextDestination };
}

/** Push the current user's location (PUT /me/location). Mock no-op. */
export async function updateMyLocation(
  _coordinates: Coordinates,
): Promise<void> {
  return;
}
