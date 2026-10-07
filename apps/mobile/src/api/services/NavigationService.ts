import type {
  MemberNavigationState,
  NavigationMemberStatus,
  NavigationSession,
  NavigationSessionStatus,
} from '../../types/navigation';
import { supabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';
import type { Destination } from '../../types';

let subscriptionSequence = 0;

interface NavigationSessionRow {
  id: string;
  group_id: string;
  scope_subgroup_id?: string | null;
  destination_id: string;
  destination_name: string;
  destination_latitude: number;
  destination_longitude: number;
  arrival_radius_m: number;
  started_by: string;
  request_id: string;
  started_at: string;
  expires_at: string;
  status: NavigationSessionStatus;
  version: number;
  navigation_member_states?: { user_id: string }[];
}

interface NavigationMemberStateRow {
  navigation_session_id: string;
  user_id: string;
  local_status: NavigationMemberStatus;
  detail: Record<string, unknown> | null;
  latest_distance_m: number | null;
  latest_accuracy_m: number | null;
  live_activity_id: string | null;
  acknowledged_at: string | null;
  arrived_at: string | null;
  updated_at: string;
}

function firstRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function mapNavigationSession(row: NavigationSessionRow): NavigationSession {
  return {
    id: row.id,
    groupId: row.group_id,
    scopeSubgroupId: row.scope_subgroup_id ?? null,
    destinationId: row.destination_id,
    destination: {
      name: row.destination_name,
      coordinates: {
        latitude: row.destination_latitude,
        longitude: row.destination_longitude,
      },
      arrivalRadiusMeters: row.arrival_radius_m,
    },
    startedBy: row.started_by,
    requestId: row.request_id,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    status: row.status,
    version: row.version,
    ...(row.navigation_member_states ? { memberIds: row.navigation_member_states.map(member => member.user_id) } : {}),
  };
}

export function mapNavigationMemberState(
  row: NavigationMemberStateRow,
): MemberNavigationState {
  return {
    navigationSessionId: row.navigation_session_id,
    userId: row.user_id,
    localStatus: row.local_status,
    detail: row.detail ?? {},
    latestDistanceMeters: row.latest_distance_m,
    latestAccuracyMeters: row.latest_accuracy_m,
    liveActivityId: row.live_activity_id,
    acknowledgedAt: row.acknowledged_at,
    arrivedAt: row.arrived_at,
    updatedAt: row.updated_at,
  };
}

function requireSessionRow(data: unknown): NavigationSessionRow {
  const row = firstRow(data as NavigationSessionRow | NavigationSessionRow[] | null);
  if (!row) throw new Error('Navigation Session 回傳空資料');
  return row;
}

function requireMemberStateRow(data: unknown): NavigationMemberStateRow {
  const row = firstRow(
    data as NavigationMemberStateRow | NavigationMemberStateRow[] | null,
  );
  if (!row) throw new Error('Navigation member state 回傳空資料');
  return row;
}

export async function startNavigationSession(
  groupId: string,
  destinationId: string,
  requestId: string,
  replaceExisting = false,
): Promise<NavigationSession> {
  const rpc = replaceExisting
    ? 'start_navigation_session_switch'
    : 'start_navigation_session';
  const { data, error } = await supabase.rpc(rpc, {
    p_group_id: groupId,
    p_destination_id: destinationId,
    p_request_id: requestId,
  });
  orThrow(error);
  return mapNavigationSession(requireSessionRow(data));
}

export async function cancelNavigationSession(
  sessionId: string,
  expectedVersion: number,
): Promise<NavigationSession> {
  const { data, error } = await supabase.rpc('cancel_navigation_session', {
    p_session_id: sessionId,
    p_expected_version: expectedVersion,
  });
  orThrow(error);
  return mapNavigationSession(requireSessionRow(data));
}

export async function completeNavigationSession(
  sessionId: string,
  expectedVersion: number,
): Promise<NavigationSession> {
  const { data, error } = await supabase.rpc('complete_navigation_session', {
    p_session_id: sessionId,
    p_expected_version: expectedVersion,
  });
  orThrow(error);
  return mapNavigationSession(requireSessionRow(data));
}

export async function ackNavigationSession(
  sessionId: string,
  status: NavigationMemberStatus,
  detail: Record<string, unknown> = {},
): Promise<MemberNavigationState> {
  const { data, error } = await supabase.rpc('ack_navigation_session', {
    p_session_id: sessionId,
    p_status: status,
    p_detail: detail,
  });
  orThrow(error);
  return mapNavigationMemberState(requireMemberStateRow(data));
}

/**
 * Persist the account-level gate for all location use. The ingestion RPC enforces this
 * row so a stale/background client cannot bypass the user's choice.
 */
export async function setLocationSharingEnabled(enabled: boolean, expectedUserId?: string): Promise<void> {
  const userId = await requireUserId();
  if (expectedUserId && userId !== expectedUserId) throw new Error('location_privacy_account_changed');
  const { error } = await supabase.from('member_privacy_settings').upsert({
    user_id: userId,
    sharing_enabled: enabled,
    local_navigation_enabled: enabled,
    updated_at: new Date().toISOString(),
  });
  orThrow(error);
}

export async function getLocationSharingEnabled(): Promise<boolean | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('member_privacy_settings')
    .select('sharing_enabled')
    .eq('user_id', userId)
    .maybeSingle();
  orThrow(error);
  return data?.sharing_enabled ?? null;
}

export async function getActiveNavigationSession(
  groupId: string,
  scopeSubgroupId: string | null = null,
): Promise<NavigationSession | null> {
  const baseQuery = supabase
    .from('navigation_sessions')
    .select('*, navigation_member_states(user_id)')
    .eq('group_id', groupId)
    .eq('status', 'active');
  const scopedQuery = scopeSubgroupId == null
    ? baseQuery.is('scope_subgroup_id', null)
    : baseQuery.eq('scope_subgroup_id', scopeSubgroupId);
  const { data, error } = await scopedQuery
    .gt('expires_at', new Date().toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  orThrow(error);
  return data ? mapNavigationSession(data as NavigationSessionRow) : null;
}

/** Read one known session, including terminal status; a missing row is unknown. */
export async function getNavigationSessionById(
  groupId: string, sessionId: string, scopeSubgroupId: string | null = null,
): Promise<NavigationSession | null> {
  const query = () => {
    const base = supabase.from('navigation_sessions').select('*, navigation_member_states(user_id)').eq('group_id', groupId);
    return scopeSubgroupId == null ? base.is('scope_subgroup_id', null) : base.eq('scope_subgroup_id', scopeSubgroupId);
  };
  const direct = await query().eq('id', sessionId).maybeSingle();
  orThrow(direct.error);
  if (direct.data) return mapNavigationSession(direct.data as NavigationSessionRow);
  // A local Start operation id becomes the server request_id after ACK. Its
  // matching terminal must remain discoverable even before id hydration.
  const alias = await query().eq('request_id', sessionId).maybeSingle();
  orThrow(alias.error);
  return alias.data ? mapNavigationSession(alias.data as NavigationSessionRow) : null;
}

/** Minimal background control data; never downloads teammates' positions. */
export async function getBackgroundNavigationContext(groupId: string, scopeSubgroupId?: string | null): Promise<{
  actorId: string; hasMembership: boolean; sharingEnabled: boolean;
  session: NavigationSession | null; target: Destination | null;
  navigationMemberIds?: string[]; arrivedMemberIds?: string[]; leaderId?: string;
}> {
  const actorId = await requireUserId();
  const [memberResult, sharingEnabled] = await Promise.all([
    supabase.from('memberships').select('subgroup_id, solo').eq('group_id', groupId).eq('user_id', actorId).maybeSingle(),
    getLocationSharingEnabled(),
  ]);
  orThrow(memberResult.error);
  const member = memberResult.data;
  // Callers that do not yet have a hydrated scope use the membership row as
  // the safe default. Explicit null means the main-team session.
  const resolvedScope = scopeSubgroupId === undefined
    ? (member?.subgroup_id ?? null)
    : scopeSubgroupId;
  const result = { actorId, hasMembership: Boolean(member), sharingEnabled: sharingEnabled !== false,
    session: null as NavigationSession | null, target: null as Destination | null };
  if (!member || member.solo || sharingEnabled === false) return result;
  const session = await getActiveNavigationSession(groupId, resolvedScope);
  if (!session) return result;
  const { data, error } = await supabase.from('itinerary_items')
    .select('id, title, latitude, longitude, position, day, subgroup_id, closed_at')
    .eq('group_id', groupId).eq('id', session.destinationId).maybeSingle();
  orThrow(error);
  if (!data || data.day == null || data.closed_at || (data.subgroup_id ?? null) !== (member.subgroup_id ?? null)) return { ...result, session };
  const [rosterResult, arrivalsResult, subgroupResult] = await Promise.all([
    supabase.from('memberships').select('user_id, role, subgroup_id, solo').eq('group_id', groupId),
    supabase.from('destination_arrivals').select('user_id').eq('group_id', groupId)
      .eq('destination_id', session.destinationId).eq('navigation_session_id', session.id),
    resolvedScope == null ? Promise.resolve({ data: null, error: null })
      : supabase.from('subgroups').select('leader_id').eq('group_id', groupId).eq('id', resolvedScope).maybeSingle(),
  ]);
  orThrow(rosterResult.error);
  orThrow(arrivalsResult.error);
  orThrow(subgroupResult.error);
  const scopedMembers = (rosterResult.data ?? []).filter(row => !row.solo
    && (row.subgroup_id ?? null) === resolvedScope
    && (session.memberIds === undefined || session.memberIds.includes(row.user_id)));
  return { ...result, session,
    navigationMemberIds: scopedMembers.map(row => row.user_id),
    arrivedMemberIds: (arrivalsResult.data ?? []).map(row => row.user_id),
    leaderId: resolvedScope == null ? scopedMembers.find(row => row.role === 'leader')?.user_id
      : subgroupResult.data?.leader_id ?? undefined,
    target: { id: data.id, title: data.title,
    coordinates: { latitude: data.latitude, longitude: data.longitude }, order: data.position,
    day: data.day, subgroupId: data.subgroup_id ?? undefined } };
}

export async function getMyNavigationMemberState(
  sessionId: string,
): Promise<MemberNavigationState | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('navigation_member_states')
    .select('*')
    .eq('navigation_session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();
  orThrow(error);
  return data ? mapNavigationMemberState(data as NavigationMemberStateRow) : null;
}

/**
 * Leader exception center: read every member's technical navigation state for
 * the active session. RLS already allows group members to select these rows.
 */
export async function listNavigationMemberStates(
  sessionId: string,
): Promise<MemberNavigationState[]> {
  const { data, error } = await supabase
    .from('navigation_member_states')
    .select('*')
    .eq('navigation_session_id', sessionId);
  orThrow(error);
  return (data as NavigationMemberStateRow[] | null)?.map(mapNavigationMemberState) ?? [];
}

export interface SessionMemberStateHandlers {
  /** Called when a row is deleted (or UPDATE clears) so the leader list drops stale tech state. */
  onRemove?: (userId: string) => void;
  onReady?: () => void;
}

/**
 * Subscribe to all navigation_member_states for a session (leader exception
 * center). Own-state ack path still uses {@link subscribeNavigationSession}.
 * Handles INSERT/UPDATE via `payload.new` and DELETE via `payload.old`.
 */
export async function subscribeSessionMemberStates(
  sessionId: string,
  onMemberState: (state: MemberNavigationState) => void,
  handlers: SessionMemberStateHandlers = {},
): Promise<() => void> {
  const channel = supabase
    .channel(`navigation-member-states:${sessionId}:${++subscriptionSequence}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'navigation_member_states',
        filter: `navigation_session_id=eq.${sessionId}`,
      },
      (payload) => {
        const eventType = payload.eventType;
        if (eventType === 'DELETE') {
          const oldRow = payload.old as { user_id?: string } | null;
          if (oldRow?.user_id) handlers.onRemove?.(oldRow.user_id);
          return;
        }
        if (payload.new && Object.keys(payload.new).length > 0) {
          onMemberState(
            mapNavigationMemberState(
              payload.new as unknown as NavigationMemberStateRow,
            ),
          );
        }
      },
    )
    .subscribe(status => { if (status === 'SUBSCRIBED') handlers.onReady?.(); });

  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function subscribeNavigationSession(
  groupId: string,
  onSession: (session: NavigationSession) => void,
  onMemberState: (state: MemberNavigationState) => void,
  scopeSubgroupId: string | null = null,
  onReady?: () => void,
): Promise<() => void> {
  const userId = await requireUserId();
  const channel = supabase
    .channel(`navigation-session:${groupId}:${userId}:${++subscriptionSequence}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'navigation_sessions',
        filter: `group_id=eq.${groupId}`,
      },
      (payload) => {
        if (payload.new && Object.keys(payload.new).length > 0) {
          const next = mapNavigationSession(payload.new as unknown as NavigationSessionRow);
          if ((next.scopeSubgroupId ?? null) !== scopeSubgroupId) return;
          onSession(next);
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'navigation_member_states',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (payload.new && Object.keys(payload.new).length > 0) {
          onMemberState(
            mapNavigationMemberState(
              payload.new as unknown as NavigationMemberStateRow,
            ),
          );
        }
      },
    )
    .subscribe(status => { if (status === 'SUBSCRIBED') onReady?.(); });

  return () => {
    void supabase.removeChannel(channel);
  };
}
