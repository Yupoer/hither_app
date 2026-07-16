import type {
  MemberNavigationState,
  NavigationMemberStatus,
  NavigationSession,
  NavigationSessionStatus,
} from '../../types/navigation';
import { supabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';

interface NavigationSessionRow {
  id: string;
  group_id: string;
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
): Promise<NavigationSession> {
  const { data, error } = await supabase.rpc('start_navigation_session', {
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
 * Persist the account-level location sharing gate. Local navigation remains
 * enabled by design; the location ingestion RPC independently enforces this
 * row so a stale/background client cannot bypass the user's choice.
 */
export async function setLocationSharingEnabled(enabled: boolean): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from('member_privacy_settings').upsert({
    user_id: userId,
    sharing_enabled: enabled,
    local_navigation_enabled: true,
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
): Promise<NavigationSession | null> {
  const { data, error } = await supabase
    .from('navigation_sessions')
    .select('*')
    .eq('group_id', groupId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  orThrow(error);
  return data ? mapNavigationSession(data as NavigationSessionRow) : null;
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

export async function subscribeNavigationSession(
  groupId: string,
  onSession: (session: NavigationSession) => void,
  onMemberState: (state: MemberNavigationState) => void,
): Promise<() => void> {
  const userId = await requireUserId();
  const channel = supabase
    .channel(`navigation-session:${groupId}:${userId}`)
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
          onSession(mapNavigationSession(payload.new as unknown as NavigationSessionRow));
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
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
