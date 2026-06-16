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
 * Phase 3 status: these are STUBS. They return mock data so the app and
 * tests can run end-to-end without a live server. Each function maps to a
 * real endpoint in the Vapor API (hither_api/Sources/hither_api/routes.swift):
 *
 *   createGroup           -> POST   /groups
 *   joinGroup             -> POST   /groups/join
 *   getGroupState         -> GET    /groups/:groupID   (GroupDetailResponse)
 *   updateNextDestination -> PUT    /groups/:groupID/itineraries/order
 *
 * No real network or business logic yet.
 */

// --- Mock data -------------------------------------------------------------

const MOCK_MEMBERS: MemberLocation[] = [
  {
    userId: 'u_leader',
    name: '隊長小燈籠',
    role: 'leader',
    status: 'active',
    coordinates: { latitude: 25.0418, longitude: 121.5654 },
    lastUpdated: '2026-06-16T09:00:00.000Z',
  },
  {
    userId: 'u_follower_1',
    name: '迷路的貓',
    role: 'follower',
    status: 'active',
    coordinates: { latitude: 25.0421, longitude: 121.5661 },
    lastUpdated: '2026-06-16T09:00:05.000Z',
  },
  {
    userId: 'u_follower_2',
    name: '愛拍照的熊',
    role: 'follower',
    status: 'idle',
    coordinates: { latitude: 25.0409, longitude: 121.5648 },
    lastUpdated: '2026-06-16T08:59:40.000Z',
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
    coordinates: { latitude: 24.8047, longitude: 120.9655 },
    travelDistance: 1200,
    travelTime: 900,
  },
];

function mockGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 'grp_mock',
    name: 'Hither 測試團',
    inviteCode: 'ABC234',
    createdBy: 'u_leader',
    createdAt: '2026-06-16T08:55:00.000Z',
    ...overrides,
  };
}

function mockGroupState(group: Group): GroupState {
  return {
    group,
    members: MOCK_MEMBERS,
    destinations: MOCK_DESTINATIONS,
    nextDestination: MOCK_DESTINATIONS[0],
  };
}

// --- Stub API functions ----------------------------------------------------

/** Create a new group (POST /groups). Returns the created group. */
export async function createGroup(name: string): Promise<Group> {
  return mockGroup({ name, inviteCode: 'NEW234' });
}

/** Join a group using its 6-char invite code (POST /groups/join). */
export async function joinGroup(inviteCode: string): Promise<Group> {
  return mockGroup({ inviteCode: inviteCode.toUpperCase() });
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

/** Push the current user's location (PUT /me/location). Stub no-op. */
export async function updateMyLocation(
  _coordinates: Coordinates,
): Promise<void> {
  return;
}
