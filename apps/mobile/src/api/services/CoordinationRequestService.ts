/**
 * CoordinationRequestService — OTA-09 lifecycle:
 * create → respond (changeable while open) → deadline/override resolve →
 * versioned itinerary apply. Responses are separate from navigation state.
 */
import { supabase } from '../supabase';
import type {
  CoordinationOption,
  CoordinationOptionKind,
  CoordinationPolicy,
  CoordinationRequest,
  CoordinationRequestStatus,
  CoordinationResolutionSource,
  CoordinationResponse,
  CoordinationSubjectKind,
  ItineraryOperation,
} from '../../types';
import { orThrow } from './_helpers';

// ── Row shapes ─────────────────────────────────────────────────────────────

interface CoordinationRequestRow {
  id: string;
  group_id: string;
  subgroup_id: string | null;
  created_by: string;
  subject: string;
  subject_kind: CoordinationSubjectKind;
  options: unknown;
  deadline: string;
  policy: CoordinationPolicy;
  default_outcome: string;
  status: CoordinationRequestStatus;
  resolved_outcome: string | null;
  resolution_source: CoordinationResolutionSource | null;
  resolved_at: string | null;
  resolved_by: string | null;
  applied_operation_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CoordinationResponseRow {
  id: string;
  request_id: string;
  user_id: string;
  option_id: string;
  responded_at: string;
  updated_at: string;
}

interface ItineraryOperationRow {
  id: string;
  group_id: string;
  subgroup_id: string | null;
  version: number;
  operation_type: ItineraryOperation['operationType'];
  payload: Record<string, unknown> | null;
  source_request_id: string | null;
  created_by: string | null;
  created_at: string;
}

// ── Mappers ────────────────────────────────────────────────────────────────

const OPTION_KINDS = new Set<CoordinationOptionKind>([
  'keep_current',
  'reject',
  'no_change',
  'gathering_point',
  'meet_time',
  'route',
  'itinerary',
]);

function mapOption(raw: unknown): CoordinationOption | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as {
    id?: unknown;
    label?: unknown;
    kind?: unknown;
    payload?: unknown;
  };
  if (typeof o.id !== 'string' || typeof o.label !== 'string') return null;
  // Drop options with unknown kind rather than silently coercing to keep_current.
  if (typeof o.kind !== 'string' || !OPTION_KINDS.has(o.kind as CoordinationOptionKind)) {
    return null;
  }
  const kind = o.kind as CoordinationOptionKind;
  const payload =
    o.payload && typeof o.payload === 'object'
      ? (o.payload as CoordinationOption['payload'])
      : undefined;
  return {
    id: o.id,
    label: o.label,
    kind,
    ...(payload ? { payload } : {}),
  };
}

export function mapCoordinationRequest(row: CoordinationRequestRow): CoordinationRequest {
  const options = Array.isArray(row.options)
    ? row.options.map(mapOption).filter((o): o is CoordinationOption => o != null)
    : [];
  return {
    id: row.id,
    groupId: row.group_id,
    subgroupId: row.subgroup_id ?? undefined,
    createdBy: row.created_by,
    subject: row.subject,
    subjectKind: row.subject_kind,
    options,
    deadline: row.deadline,
    policy: row.policy,
    defaultOutcome: row.default_outcome,
    status: row.status,
    resolvedOutcome: row.resolved_outcome,
    resolutionSource: row.resolution_source,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    appliedOperationId: row.applied_operation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCoordinationResponse(row: CoordinationResponseRow): CoordinationResponse {
  return {
    id: row.id,
    requestId: row.request_id,
    userId: row.user_id,
    optionId: row.option_id,
    respondedAt: row.responded_at,
    updatedAt: row.updated_at,
  };
}

export function mapItineraryOperation(row: ItineraryOperationRow): ItineraryOperation {
  return {
    id: row.id,
    groupId: row.group_id,
    subgroupId: row.subgroup_id ?? undefined,
    version: row.version,
    operationType: row.operation_type,
    payload: row.payload ?? {},
    sourceRequestId: row.source_request_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function optionToJson(option: CoordinationOption): Record<string, unknown> {
  return {
    id: option.id,
    label: option.label,
    kind: option.kind,
    ...(option.payload
      ? {
          payload: {
            ...(option.payload.destinationId != null
              ? { destinationId: option.payload.destinationId }
              : {}),
            ...(option.payload.title != null ? { title: option.payload.title } : {}),
            ...(option.payload.address !== undefined
              ? { address: option.payload.address }
              : {}),
            ...(option.payload.latitude != null
              ? { latitude: option.payload.latitude }
              : {}),
            ...(option.payload.longitude != null
              ? { longitude: option.payload.longitude }
              : {}),
            ...(option.payload.day != null ? { day: option.payload.day } : {}),
            ...(option.payload.meetAt !== undefined
              ? { meetAt: option.payload.meetAt }
              : {}),
          },
        }
      : {}),
  };
}

// ── API ────────────────────────────────────────────────────────────────────

export interface CreateCoordinationRequestInput {
  groupId: string;
  subgroupId?: string | null;
  subject: string;
  subjectKind: CoordinationSubjectKind;
  options: CoordinationOption[];
  deadline: string;
  policy: CoordinationPolicy;
  defaultOutcome: string;
}

export async function createCoordinationRequest(
  input: CreateCoordinationRequestInput,
): Promise<CoordinationRequest> {
  const { data, error } = await supabase.rpc('create_coordination_request', {
    p_group_id: input.groupId,
    p_subgroup_id: input.subgroupId ?? null,
    p_subject: input.subject,
    p_subject_kind: input.subjectKind,
    p_options: input.options.map(optionToJson),
    p_deadline: input.deadline,
    p_policy: input.policy,
    p_default_outcome: input.defaultOutcome,
  });
  orThrow(error);
  return mapCoordinationRequest(data as CoordinationRequestRow);
}

/**
 * Record or change a participant response while the request is open.
 * Unanswered clients simply do not call this — silence is not stored as a vote.
 */
export async function respondToCoordinationRequest(
  requestId: string,
  optionId: string,
): Promise<CoordinationResponse> {
  const { data, error } = await supabase.rpc('respond_to_coordination_request', {
    p_request_id: requestId,
    p_option_id: optionId,
  });
  orThrow(error);
  return mapCoordinationResponse(data as CoordinationResponseRow);
}

/** Leader force-close with a chosen option (organizer override). */
export async function overrideCoordinationRequest(
  requestId: string,
  optionId: string,
): Promise<CoordinationRequest> {
  const { data, error } = await supabase.rpc('override_coordination_request', {
    p_request_id: requestId,
    p_option_id: optionId,
  });
  orThrow(error);
  return mapCoordinationRequest(data as CoordinationRequestRow);
}

/**
 * Atomically resolve a single request past its deadline.
 * Safe to call from multiple devices — one authoritative outcome.
 */
export async function resolveCoordinationRequestDeadline(
  requestId: string,
): Promise<CoordinationRequest> {
  const { data, error } = await supabase.rpc('resolve_coordination_request_deadline', {
    p_request_id: requestId,
  });
  orThrow(error);
  return mapCoordinationRequest(data as CoordinationRequestRow);
}

/** Resolve every due open request in a group (idempotent). */
export async function resolveDueCoordinationRequests(
  groupId: string,
): Promise<CoordinationRequest[]> {
  const { data, error } = await supabase.rpc('resolve_due_coordination_requests', {
    p_group_id: groupId,
  });
  orThrow(error);
  return ((data ?? []) as CoordinationRequestRow[]).map(mapCoordinationRequest);
}

export async function cancelCoordinationRequest(
  requestId: string,
): Promise<CoordinationRequest> {
  const { data, error } = await supabase.rpc('cancel_coordination_request', {
    p_request_id: requestId,
  });
  orThrow(error);
  return mapCoordinationRequest(data as CoordinationRequestRow);
}

export async function fetchCoordinationRequests(
  groupId: string,
  options?: { status?: CoordinationRequestStatus | CoordinationRequestStatus[] },
): Promise<CoordinationRequest[]> {
  // Best-effort due resolution so multi-device clients converge without a cron.
  try {
    await resolveDueCoordinationRequests(groupId);
  } catch {
    // Fetch still returns current rows if resolve is blocked.
  }

  let query = supabase
    .from('coordination_requests')
    .select(
      'id, group_id, subgroup_id, created_by, subject, subject_kind, options, deadline, policy, default_outcome, status, resolved_outcome, resolution_source, resolved_at, resolved_by, applied_operation_id, created_at, updated_at',
    )
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (options?.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    query = query.in('status', statuses);
  }

  const { data, error } = await query;
  orThrow(error);
  return ((data ?? []) as CoordinationRequestRow[]).map(mapCoordinationRequest);
}

export async function fetchCoordinationResponses(
  requestId: string,
): Promise<CoordinationResponse[]> {
  const { data, error } = await supabase
    .from('coordination_responses')
    .select('id, request_id, user_id, option_id, responded_at, updated_at')
    .eq('request_id', requestId)
    .order('responded_at', { ascending: true });
  orThrow(error);
  return ((data ?? []) as CoordinationResponseRow[]).map(mapCoordinationResponse);
}

export async function fetchItineraryOperations(
  groupId: string,
): Promise<ItineraryOperation[]> {
  const { data, error } = await supabase
    .from('itinerary_operations')
    .select(
      'id, group_id, subgroup_id, version, operation_type, payload, source_request_id, created_by, created_at',
    )
    .eq('group_id', groupId)
    .order('version', { ascending: true });
  orThrow(error);
  return ((data ?? []) as ItineraryOperationRow[]).map(mapItineraryOperation);
}
