import type { MemberLocation } from './memberLocation';
import type { Destination } from './destination';

/**
 * A travel group. Mirrors `Group` in the Vapor API (Models/Group.swift).
 *
 * `inviteCode` is the 6-character "group code" users type to join
 * (uppercase letters/digits, ambiguous chars removed server-side).
 */
export interface Group {
  id: string;
  name: string;
  inviteCode: string;
  createdBy: string;
  createdAt?: string;
}

/**
 * Aggregated view used by the Group and Map screens.
 *
 * Roughly corresponds to the API's `GroupDetailResponse`
 * (group + members), extended with the itinerary/destinations the
 * design needs (gathering point / next destination).
 */
export interface GroupState {
  group: Group;
  members: MemberLocation[];
  destinations: Destination[];
  /** The destination the group is currently heading to, if any. */
  nextDestination?: Destination;
}
