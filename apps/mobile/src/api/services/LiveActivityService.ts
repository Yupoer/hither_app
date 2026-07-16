import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { TravelMode } from '../../utils/geo';
import { supabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';

const LIVE_ACTIVITY_DEVICE_ID_KEY = 'hither.live-activity-device-id';
let deviceIdPromise: Promise<string> | null = null;

export function getOrCreateLiveActivityDeviceId(): Promise<string> {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      const stored = await SecureStore.getItemAsync(LIVE_ACTIVITY_DEVICE_ID_KEY);
      if (stored) return stored;
      const created = Crypto.randomUUID();
      await SecureStore.setItemAsync(LIVE_ACTIVITY_DEVICE_ID_KEY, created);
      return created;
    })().catch((error) => {
      deviceIdPromise = null;
      throw error;
    });
  }
  return deviceIdPromise;
}

export async function upsertDeviceActivityToken(
  deviceId: string,
  pushToStartToken: string | null,
  enabled: boolean,
): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase.from('device_live_activity_tokens').upsert(
    {
      user_id: uid,
      device_id: deviceId,
      push_to_start_token: pushToStartToken,
      live_activities_enabled: pushToStartToken === null ? false : enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,device_id' },
  );
  orThrow(error);
}

export interface LiveActivitySessionInput {
  groupId: string;
  destinationId: string;
  activityId: string;
  pushToken?: string;
  initialDistanceM: number;
  currentDistanceM: number;
  etaSeconds?: number;
  travelMode: TravelMode;
}

export async function upsertLiveActivitySession(
  input: LiveActivitySessionInput,
): Promise<void> {
  const uid = await requireUserId();
  const progress = Math.min(
    1,
    Math.max(0, 1 - input.currentDistanceM / input.initialDistanceM),
  );
  const { error } = await supabase.from('live_activity_sessions').upsert(
    {
      user_id: uid,
      group_id: input.groupId,
      destination_id: input.destinationId,
      activity_id: input.activityId,
      push_token: input.pushToken ?? null,
      initial_distance_m: input.initialDistanceM,
      current_distance_m: Math.max(0, input.currentDistanceM),
      eta_seconds: input.etaSeconds == null ? null : Math.max(0, Math.round(input.etaSeconds)),
      travel_mode: input.travelMode,
      last_progress_bucket: Math.round(progress * 20),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,group_id' },
  );
  orThrow(error);
}

export async function deleteLiveActivitySession(activityId: string): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase
    .from('live_activity_sessions')
    .delete()
    .eq('user_id', uid)
    .eq('activity_id', activityId);
  orThrow(error);
}

/** Delete every live_activity_sessions row owned by the current user. */
export async function deleteMyLiveActivitySessions(): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase
    .from('live_activity_sessions')
    .delete()
    .eq('user_id', uid);
  orThrow(error);
}

/** Delete the current user's live_activity_sessions rows for the given groups. */
export async function deleteMyLiveActivitySessionsForGroups(
  groupIds: string[],
): Promise<void> {
  if (!groupIds.length) return;
  const uid = await requireUserId();
  const { error } = await supabase
    .from('live_activity_sessions')
    .delete()
    .eq('user_id', uid)
    .in('group_id', groupIds);
  orThrow(error);
}
