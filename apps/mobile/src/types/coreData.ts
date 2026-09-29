/**
 * OTA-04 Local-first core data types.
 *
 * First batch: group snapshot, itinerary, active gathering state, and personal
 * navigation announcement responses. Transport-neutral so Supabase (now) and a
 * future Nearby spike can carry the same operation contract.
 */

import type { Destination, Group, GroupState } from './index';

/** Global journey phase (OTA-01). Not a third clickable "started" button. */
export type JourneyPhase = 'staying' | 'en_route';

/** Per gathering-point status (OTA-01). */
export type GatheringPointStatus = 'pending' | 'en_route' | 'completed';

/**
 * Personal navigation announcement response (OTA-02 shape, user-scoped).
 * Never merged into team gathering phase.
 */
export type NavigationAnnouncementResponseKind =
  | 'acknowledged'
  | 'late'
  | 'needs_help';

export type CoreEntityType =
  | 'group_snapshot'
  | 'active_gathering'
  | 'navigation_response'
  | 'itinerary';

export type CoreOperationType =
  | 'send_command'
  | 'leader_correct_arrival'
  | 'record_arrival'
  | 'replace_snapshot'
  | 'start_gathering'
  | 'switch_gathering'
  | 'end_gathering'
  | 'set_navigation_response'
  | 'add_destination'
  | 'edit_destination'
  | 'delete_destination'
  | 'reorder_destinations'
  | 'set_destination_meet_time'
  | 'complete_destination'
  | 'submit_gather_point_request'
  | 'resolve_gather_point_request';

export type CoreOperationStatus =
  | 'pending'
  | 'inflight'
  | 'acked'
  | 'conflict'
  | 'failed';

/** How the local snapshot was obtained. */
export type CoreSnapshotSource = 'remote' | 'local_optimistic' | 'local_cache';

/**
 * Active gathering state projected with OTA-01 semantics.
 * `pointStatuses` is keyed by destination id; missing keys default to pending.
 *
 * While `journeyPhase === 'staying'`, `activeDestinationId` is null (server-
 * shaped: no active travel). Next pending is derived from `pointStatuses`, not
 * stored as a travelling id. While `en_route`, id is the active stop.
 * See `teamGatheringState` for live map/session projection (same End rules).
 */
export interface ActiveGatheringState {
  groupId: string;
  journeyPhase: JourneyPhase;
  /** Travelling destination while en_route; null while staying. */
  activeDestinationId: string | null;
  pointStatuses: Record<string, GatheringPointStatus>;
  /** Epoch ms when phase last changed. */
  phaseChangedAt: number;
  entityVersion: number;
}

/** User-scoped navigation response; never updates team phase. */
export interface NavigationAnnouncementResponse {
  sessionId: string;
  userId: string;
  groupId: string;
  response: NavigationAnnouncementResponseKind | null;
  entityVersion: number;
  updatedAt: number;
}

/**
 * First-batch core snapshot: group + itinerary (+ derived gathering).
 * Members/live GPS are best-effort cache only and not required offline.
 */
export interface CoreGroupSnapshot {
  groupId: string;
  /** Actor that owns unpublished local projection, absent for authoritative data. */
  ownerActorId?: string;
  group: Group;
  destinations: Destination[];
  /** Optional member cache for offline UI; live GPS is out of scope. */
  members?: GroupState['members'];
  subgroups?: GroupState['subgroups'];
  activeGathering: ActiveGatheringState;
  /** Snapshot entity version (monotone per group). */
  entityVersion: number;
  /** Independent itinerary entity version used by destination CRUD operations. */
  itineraryVersion?: number;
  /** Epoch ms when this snapshot was last confirmed from remote. */
  syncedAt: number;
  /** Epoch ms of the latest local write. */
  updatedAt: number;
  source: CoreSnapshotSource;
}

/** Retained failure receipt; automatic recovery never asks the user to merge. */
export interface CoreConflictResult {
  code:
    | 'stale_version'
    | 'invalid_transition'
    | 'unauthorized'
    | 'validation'
    | 'dependency_missing'
    | 'account_changed'
    | 'unknown';
  message: string;
  serverEntityVersion?: number;
  serverState?: unknown;
  operationId: string;
  entityType: CoreEntityType;
  entityId: string;
  occurredAt: number;
}

/** Transport-neutral mutation carried by the operation outbox. */
export interface CoreOperation {
  id: string;
  /** Auth actor bound at creation. Undefined is retained only for old rows/tests. */
  actorId?: string;
  groupId: string;
  entityType: CoreEntityType;
  entityId: string;
  /** Base entity version this op was built against. */
  entityVersion: number;
  operationType: CoreOperationType;
  payload: Record<string, unknown>;
  /** Monotone durable client sequence scoped to actor + group. */
  sequence?: number;
  /** Accepted operation ids that must precede this operation. */
  dependencyIds?: string[];
  /** Diagnostic fields retained across restart; not part of the server payload. */
  inflightStartedAt?: number;
  lastError?: string;
  createdAt: number;
  status: CoreOperationStatus;
  attempts: number;
  nextAttemptAt: number;
  conflictResult: CoreConflictResult | null;
  updatedAt: number;
}

export type CoreSnapshotReadOutcome =
  | { kind: 'hit'; snapshot: CoreGroupSnapshot }
  | { kind: 'empty' }
  | { kind: 'stale'; snapshot: CoreGroupSnapshot; ageMs: number };

/** UI-facing freshness classification. */
export type CoreSnapshotFreshness =
  | { unit: 'fresh' }
  | { unit: 'aging'; ageMs: number }
  | { unit: 'stale'; ageMs: number }
  | { unit: 'missing' };

export interface ApplyCoreOperationAccepted {
  status: 'accepted';
  operationId: string;
  entityVersion: number;
  /** Optional authoritative entity snapshot after apply. */
  entity?: unknown;
  effects?: Record<string, unknown>;
}

export interface ApplyCoreOperationDuplicate {
  status: 'duplicate';
  operationId: string;
  entityVersion: number;
  entity?: unknown;
  effects?: Record<string, unknown>;
}

export interface ApplyCoreOperationConflict {
  status: 'conflict';
  operationId: string;
  conflict: CoreConflictResult;
}

export type ApplyCoreOperationResult =
  | ApplyCoreOperationAccepted
  | ApplyCoreOperationDuplicate
  | ApplyCoreOperationConflict;
