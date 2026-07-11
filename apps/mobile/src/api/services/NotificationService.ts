/**
 * NotificationService — push tokens, commands, notification preferences.
 */
import { supabase } from '../supabase';
import { isDemoGroup } from '../demo';
import type { CommandType, Coordinates, NotificationPreferences } from '../../types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../types';
import { requireUserId, orThrow } from './_helpers';

interface NotificationPrefsRow {
  add_gathering: boolean;
  leader_commands: boolean;
  follower_requests: boolean;
  journey: boolean;
}

export function mapNotificationPreferences(
  row: NotificationPrefsRow,
): NotificationPreferences {
  return {
    addGathering: row.add_gathering,
    leaderCommands: row.leader_commands,
    followerRequests: row.follower_requests,
    journey: row.journey,
  };
}

export async function savePushToken(
  token: string | null,
  platform: 'ios' | 'android' = 'ios',
): Promise<void> {
  if (!token) return;
  const uid = await requireUserId();
  const { error } = await supabase.from('push_tokens').upsert(
    { user_id: uid, token, platform, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,token' },
  );
  orThrow(error);
}

export async function sendCommand(
  groupId: string,
  type: CommandType,
  message?: string,
  coords?: Coordinates,
): Promise<void> {
  if (isDemoGroup(groupId)) return;
  const uid = await requireUserId();
  const { error } = await supabase.from('commands').insert({
    group_id: groupId,
    sender_id: uid,
    type,
    message: message ?? null,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
  });
  orThrow(error);
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const uid = await requireUserId();
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('add_gathering, leader_commands, follower_requests, journey')
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
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  orThrow(error);
  return prefs;
}
