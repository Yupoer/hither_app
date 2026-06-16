import type { Coordinates } from './user';

/**
 * Role within a group. The API stores membership role as
 * "admin" / "member" (Models/Membership.swift); the design surfaces
 * these as leader / follower.
 */
export type MemberRole = 'leader' | 'follower';

/**
 * Presence/journey status shown next to each member on the Map and
 * Group screens. Not yet persisted by the API — derived client-side
 * for the MVP skeleton.
 */
export type MemberStatus = 'active' | 'idle' | 'arrived' | 'offline';

/**
 * A group member together with their latest location and status.
 * Combines the API's `PublicUser` (id, name, currentLocation) with the
 * membership role and a UI-only presence status.
 */
export interface MemberLocation {
  userId: string;
  /** Anonymous nickname, per the MVP design. */
  name: string;
  role: MemberRole;
  status: MemberStatus;
  coordinates?: Coordinates;
  /** ISO-8601 timestamp of the last location update. */
  lastUpdated?: string;
}
