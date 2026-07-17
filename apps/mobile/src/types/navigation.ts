import type { Coordinates } from './index';

export type NavigationSessionStatus =
  | 'active'
  | 'cancelled'
  | 'expired'
  | 'completed';

export type NavigationMemberStatus =
  | 'pending'
  | 'activity_started'
  | 'tracking_active'
  | 'permission_denied'
  | 'location_disabled'
  | 'app_force_quit_suspected'
  | 'offline'
  | 'push_unavailable'
  | 'sharing_disabled'
  | 'arriving'
  | 'arrived'
  | 'missed'
  | 'cancelled';

export interface NavigationSession {
  id: string;
  groupId: string;
  destinationId: string;
  destination: {
    name: string;
    coordinates: Coordinates;
    arrivalRadiusMeters: number;
  };
  startedBy: string;
  requestId: string;
  startedAt: string;
  expiresAt: string;
  status: NavigationSessionStatus;
  version: number;
}

export interface MemberNavigationState {
  navigationSessionId: string;
  userId: string;
  localStatus: NavigationMemberStatus;
  detail: Record<string, unknown>;
  latestDistanceMeters: number | null;
  latestAccuracyMeters: number | null;
  liveActivityId: string | null;
  acknowledgedAt: string | null;
  arrivedAt: string | null;
  updatedAt: string;
}
