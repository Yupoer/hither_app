/**
 * API client barrel ??re-exports every domain service so existing imports
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

export {
  generateInviteCode,
  requireUserId,
  orThrow,
  isNetworkRequestError,
  sleep,
} from './services/_helpers';

export {
  mapGroup,
  mapMember,
  mapSubgroup,
  mapSubgroupInvite,
  createGroup,
  joinGroup,
  getGroupState,
  getGroupRecoverySnapshot,
  setJourneyStatus,
  setJourneyTarget,
  setStragglerConfig,
  reportStraggler,
  updateGroupTripDetails,
  setSolo,
  selfSplit,
  selfMerge,
  getMyJoinedGroups,
  getCachedMyJoinedGroups,
  invalidateMyJoinedGroupsCache,
  leaveGroups,
} from './services/GroupService';

export type {
  JoinedGroupInfo,
  GetMyJoinedGroupsOptions,
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
  addDestinationsBatch,
  deleteDestination,
  completeGatheringStop,
  reorderDestinations,
  setDestinationMeetTime,
  updateDestinationEmojiColor,
} from './services/DestinationService';

export {
  getPremiumProjection,
  getPremiumAppAccountToken,
  applyVerifiedSubscription,
} from './services/EntitlementService';

export type { ItineraryRow } from './services/DestinationService';

export {
  recordVisitedWaypoint,
  fetchVisitedWaypoints,
  deleteVisitedWaypoint,
} from './services/WaypointService';

export {
  submitGatherPointRequest,
  fetchPendingGatherPointRequests,
  resolveGatherPointRequest,
  resolveGatherPointRequestResilient,
  fetchDestinationArrivals,
  setDestinationArrival,
  setDestinationArrivalAt,
} from './services/GatheringWorkflowService';
export type { ResolveGatherPointResult } from './services/GatheringWorkflowService';

export {
  mapCoordinationRequest,
  mapCoordinationResponse,
  mapItineraryOperation,
  createCoordinationRequest,
  respondToCoordinationRequest,
  overrideCoordinationRequest,
  resolveCoordinationRequestDeadline,
  resolveDueCoordinationRequests,
  cancelCoordinationRequest,
  fetchCoordinationRequests,
  fetchCoordinationResponses,
  fetchItineraryOperations,
} from './services/CoordinationRequestService';
export type { CreateCoordinationRequestInput } from './services/CoordinationRequestService';

export {
  updateNickname,
  updateProfile,
  saveOnboardingProfile,
  setProStatus,
  redeemPromoCode,
} from './services/ProfileService';

export {
  getTripEntitlement,
  applyVerifiedPurchase,
  restoreEntitlements,
} from './services/EntitlementService';

export {
  getStoreSnapshot,
  createRewardSession,
  updateRewardSessionStatus,
  redeemStoreProduct,
  mapStoreSnapshot,
} from './services/StoreService';

export {
  applyCoreOperation,
  fetchCoreEntityVersions,
} from './services/CoreDataService';
export type { CoreEntityVersionRow } from './services/CoreDataService';

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

export {
  requestGroupLocationRefresh,
  updateMyLocation,
} from './services/LocationService';

export {
  upsertLiveActivitySession,
  deleteLiveActivitySession,
  deleteMyLiveActivitySessions,
  deleteMyLiveActivitySessionsForGroups,
} from './services/LiveActivityService';
export type { LiveActivitySessionInput } from './services/LiveActivityService';

