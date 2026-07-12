/**
 * API client barrel — re-exports every domain service so existing imports
 * (`import { createGroup, addDestination, ... } from '../api/client'`) continue
 * to work without changes. New code should import directly from the specific
 * service file for faster comprehension and smaller dependency surface.
 *
 * @example
 *   // Legacy (still works):
 *   import { createGroup, addDestination } from '../api/client';
 *
 *   // Preferred:
 *   import { createGroup } from '../api/services/GroupService';
 *   import { addDestination } from '../api/services/DestinationService';
 */

export { generateInviteCode, requireUserId, orThrow } from './services/_helpers';

export {
  mapGroup,
  mapMember,
  mapSubgroup,
  mapSubgroupInvite,
  createGroup,
  joinGroup,
  getGroupState,
  setJourneyStatus,
  setStragglerConfig,
  updateGroupTripDetails,
  setSolo,
  selfSplit,
  selfMerge,
  getMyJoinedGroups,
  leaveGroups,
} from './services/GroupService';

export type {
  JoinedGroupInfo,
  GroupRow,
  MembershipRow,
  SubgroupRow,
  SubgroupInviteRow,
  ProfileRow,
  LocationRow,
} from './services/GroupService';

export {
  mapDestination,
  addDestination,
  deleteDestination,
  reorderDestinations,
  setDestinationMeetTime,
} from './services/DestinationService';

export type { ItineraryRow } from './services/DestinationService';

export {
  recordVisitedWaypoint,
  fetchVisitedWaypoints,
} from './services/WaypointService';

export {
  updateNickname,
  updateProfile,
  saveOnboardingProfile,
  setProStatus,
  redeemPromoCode,
} from './services/ProfileService';

export {
  inviteToSubgroup,
  acceptSubgroupInvite,
  declineSubgroupInvite,
  fetchMyInvites,
  fetchSentInvites,
} from './services/SubgroupService';

export {
  mapNotificationPreferences,
  savePushToken,
  sendCommand,
  getNotificationPreferences,
  setNotificationPreferences,
} from './services/NotificationService';

export { updateMyLocation } from './services/LocationService';
