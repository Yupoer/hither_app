import type { TravelMode } from '../../utils/geo';
import { supabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';

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
