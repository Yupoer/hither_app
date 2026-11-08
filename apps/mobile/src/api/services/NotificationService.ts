/**
 * NotificationService — push tokens, commands, notification preferences.
 */
import { writeInstallationCapability } from '../installationCapabilities';
import { supabase } from '../supabase';
import { isDemoGroup } from '../demo';
import type { CommandType, Coordinates, NotificationPreferences } from '../../types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../types';
import { requireUserId, orThrow } from './_helpers';
import { requireLocalActorId } from './_helpers';
import * as Crypto from 'expo-crypto';

interface NotificationPrefsRow {
  add_gathering: boolean;
  leader_commands: boolean;
  follower_requests: boolean;
  journey: boolean;
  arrival?: boolean;
}

export function mapNotificationPreferences(
  row: NotificationPrefsRow,
): NotificationPreferences {
  return {
    addGathering: row.add_gathering,
    leaderCommands: row.leader_commands,
    followerRequests: row.follower_requests,
    journey: row.journey,
    arrival: row.arrival ?? true,
  };
}

export async function savePushToken(
  token: string | null,
  platform: 'ios' | 'android' = 'ios',
  actorId?: string,
): Promise<void> {
  if (!token) return;
  const uid = actorId ?? await requireUserId();
  await writeInstallationCapability(uid, async deviceId => {
    const { error } = await supabase.from('push_tokens').upsert(
      { user_id: uid, device_id: deviceId, token, platform, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,token' },
    );
    orThrow(error);
  });
}

export async function sendCommand(
  groupId: string,
  type: CommandType,
  message?: string,
  coords?: Coordinates,
): Promise<void> {
  await enqueueCommand(groupId, {
    type, message: message ?? null,
    latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
}

async function enqueueCommand(groupId: string, payload: Record<string, string | number | null>): Promise<void> {
  if (isDemoGroup(groupId)) return;
  const { getCoreOperationOutbox, flushCoreOperationOutbox } = await import('../../state/coreDataSync');
  const uid = await requireLocalActorId();
  const operationId = Crypto.randomUUID();
  await getCoreOperationOutbox().enqueueMutation({
    operationId, actorId: uid, groupId, entityType: 'itinerary', entityId: operationId,
    operationType: 'send_command',
    payload,
  });
  void flushCoreOperationOutbox().catch(() => undefined);
}

export interface PendingStartRequest {
  id: string;
  senderId: string;
  title: string;
}

export async function requestGatheringStart(groupId: string, destinationId: string): Promise<void> {
  await enqueueCommand(groupId, { type: 'request_start', destinationId });
}

export async function fetchPendingStartRequests(groupId: string, userId: string): Promise<PendingStartRequest[]> {
  const { data, error } = await supabase.from('commands')
    .select('id, sender_id, message')
    .eq('group_id', groupId)
    .eq('target_user_id', userId)
    .eq('request_status', 'pending')
    .order('created_at', { ascending: true });
  orThrow(error);
  return (data ?? []).map(row => ({ id: row.id, senderId: row.sender_id, title: row.message }));
}

export async function resolveGatheringStart(requestId: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc('resolve_gathering_start', {
    p_request_id: requestId,
    p_approve: approve,
  });
  orThrow(error);
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const uid = await requireUserId();
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('add_gathering, leader_commands, follower_requests, journey, arrival')
    .eq('user_id', uid)
    .maybeSingle();
  orThrow(error);
  if (!data) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  return mapNotificationPreferences(data as NotificationPrefsRow);
}

export async function setNotificationPreferences(
  prefs: NotificationPreferences,
): Promise<NotificationPreferences> {
  const uid = await requireUserId();
  const { error } = await supabase.from('notification_preferences').upsert(
    {
      user_id: uid,
      add_gathering: prefs.addGathering,
      leader_commands: prefs.leaderCommands,
      follower_requests: prefs.followerRequests,
      journey: prefs.journey,
      arrival: prefs.arrival,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  orThrow(error);
  return prefs;
}
