import { getInstallationId, writeInstallationCapability } from '../installationCapabilities';
import type { TravelMode } from '../../utils/geo';
import { personalDisplayProgress, progressBucket20 } from '../../utils/journeyProgress';
import { supabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';

export const getOrCreateLiveActivityDeviceId = getInstallationId;

/** Outcome of a token register for diagnostics classification (never includes the token). */
export type LiveActivityTokenRegisterResult =
  | 'upserted'
  | 'benign_idempotent'
  | 'reclaimed_own_token'
  | 'foreign_token_conflict'
  /** Token unique 23505 but no visible owner row (RLS-hidden foreign or race). */
  | 'token_unique_unresolved'
  | 'unknown_error';

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  const message = String(error.message ?? '').toLowerCase();
  return (
    code === '23505'
    || (
      (message.includes('duplicate key') || message.includes('unique constraint'))
      && (
        message.includes('device_live_activity_tokens_token')
        || message.includes('device_live_activity_tokens_pkey')
        || message.includes('device_live_activity_tokens')
      )
    )
  );
}

function isTokenUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error || !isUniqueViolation(error)) return false;
  const message = String(error.message ?? '').toLowerCase();
  // Prefer the global push_to_start_token unique index name when present.
  return (
    message.includes('device_live_activity_tokens_token')
    || message.includes('push_to_start_token')
  );
}

export async function upsertDeviceActivityToken(deviceId: string, token: string | null, enabled: boolean, accentHex?: string, actorId?: string): Promise<LiveActivityTokenRegisterResult> {
  const uid = actorId ?? await requireUserId();
  return await writeInstallationCapability(uid, () => writeDeviceActivityToken(deviceId, token, enabled, accentHex)) ?? 'unknown_error';
}

/**
 * Register / rotate the push-to-start token for this user+device.
 * Conflict target is (user_id, device_id). Global unique on push_to_start_token
 * can still fire when the same token is already on another row — we reclaim
 * tokens owned by the current user (device rotation) and soft-fail foreign
 * ownership without overwriting another user.
 */
async function writeDeviceActivityToken(
  deviceId: string,
  pushToStartToken: string | null,
  enabled: boolean,
  accentHex?: string,
): Promise<LiveActivityTokenRegisterResult> {
  const uid = await requireUserId();
  const row = {
    user_id: uid,
    device_id: deviceId,
    push_to_start_token: pushToStartToken,
    live_activities_enabled: pushToStartToken === null ? false : enabled,
    ...(accentHex ? { accent_hex: accentHex } : {}),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('device_live_activity_tokens').upsert(
    row,
    { onConflict: 'user_id,device_id' },
  );

  if (!error) {
    return 'upserted';
  }

  // Primary-key / user+device races are benign registration idempotency.
  if (isUniqueViolation(error) && !isTokenUniqueViolation(error)) {
    return 'benign_idempotent';
  }

  if (isTokenUniqueViolation(error) && pushToStartToken) {
    // Same token already exists somewhere. Reclaim only rows owned by this user
    // (device reinstall / multi-device same APNs token), never other users.
    const { data: owners, error: selectError } = await supabase
      .from('device_live_activity_tokens')
      .select('user_id,device_id')
      .eq('push_to_start_token', pushToStartToken)
      .limit(4);

    if (selectError) {
      // Soft-fail — registration must not break map/session UI.
      return 'unknown_error';
    }

    const ownRows = (owners ?? []).filter((r) => r.user_id === uid);
    const foreign = (owners ?? []).some((r) => r.user_id !== uid);

    if (foreign && ownRows.length === 0) {
      // Another account holds this token — do not steal it.
      return 'foreign_token_conflict';
    }

    if (ownRows.length > 0) {
      // Clear token on other own devices, then write this device row.
      for (const owned of ownRows) {
        if (owned.device_id === deviceId) continue;
        const { error: clearError } = await supabase
          .from('device_live_activity_tokens')
          .update({
            push_to_start_token: null,
            live_activities_enabled: false,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', uid)
          .eq('device_id', owned.device_id);
        if (clearError) {
          // Soft-fail — do not claim reclaim succeeded when clear failed.
          return 'unknown_error';
        }
      }

      const { error: retryError } = await supabase
        .from('device_live_activity_tokens')
        .upsert(row, { onConflict: 'user_id,device_id' });

      if (!retryError) {
        return 'reclaimed_own_token';
      }
      if (isUniqueViolation(retryError)) {
        return foreign ? 'foreign_token_conflict' : 'token_unique_unresolved';
      }
      orThrow(retryError);
    }

    // Token unique fired but select found nothing — usually RLS hiding another
    // user's row. Distinct from PK race so operators do not treat as benign.
    return 'token_unique_unresolved';
  }

  if (isUniqueViolation(error)) {
    return 'benign_idempotent';
  }

  orThrow(error);
  return 'unknown_error';
}

export interface LiveActivitySessionInput {
  sampledAtMs?: number;
  etaTargetAtMs?: number;
  groupId: string;
  destinationId: string;
  activityId: string;
  accentHex?: string;
  pushToken?: string;
  initialDistanceM: number;
  currentDistanceM: number;
  etaSeconds?: number;
  travelMode: TravelMode;
  /** Gated personal remaining (0–1). Preferred over recomputing from distances. */
  progress?: number | null;
  movedFromStartM?: number;
  hasDepartedStart?: boolean;
  previousProgressMax?: number | null;
  arrived?: boolean;
}

export async function upsertLiveActivitySession(input: LiveActivitySessionInput, actorId?: string): Promise<void> {
  const uid = actorId ?? await requireUserId();
  await writeInstallationCapability(uid, () => writeLiveActivitySession(input));
}

async function writeLiveActivitySession(
  input: LiveActivitySessionInput,
): Promise<void> {
  const uid = await requireUserId();
  const progress = input.progress != null && Number.isFinite(input.progress)
    ? Math.min(1, Math.max(0, input.progress))
    : personalDisplayProgress({
        initialM: input.initialDistanceM,
        currentM: input.currentDistanceM,
        movedFromStartM: input.movedFromStartM,
        hasDepartedStart: input.hasDepartedStart,
        previousMax: input.previousProgressMax,
        arrived: input.arrived,
      });
  const { error } = await supabase.from('live_activity_sessions').upsert(
    {
      user_id: uid,
      device_id: await getInstallationId(),
      group_id: input.groupId,
      destination_id: input.destinationId,
      activity_id: input.activityId,
      ...(input.accentHex ? { accent_hex: input.accentHex } : {}),
      push_token: input.pushToken ?? null,
      initial_distance_m: input.initialDistanceM,
      current_distance_m: Math.max(0, input.currentDistanceM),
      eta_seconds: input.etaSeconds == null ? null : Math.max(0, Math.round(input.etaSeconds)),
      travel_mode: input.travelMode,
      last_progress_bucket: progressBucket20(progress),
      // Store ETA and its origin as one snapshot, even when resuming later.
      updated_at: new Date(input.etaTargetAtMs != null && input.etaSeconds != null
        ? input.etaTargetAtMs - Math.max(0, Math.round(input.etaSeconds)) * 1000
        : input.sampledAtMs ?? Date.now()).toISOString(),
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
    .eq('device_id', await getInstallationId())
    .eq('activity_id', activityId);
  orThrow(error);
}

/** Delete only this installation's Live Activity sessions. */
export async function deleteMyLiveActivitySessions(): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase
    .from('live_activity_sessions')
    .delete()
    .eq('user_id', uid)
    .eq('device_id', await getInstallationId());
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
    .eq('device_id', await getInstallationId())
    .in('group_id', groupIds);
  orThrow(error);
}

export async function updateDeviceActivityAccent(deviceId: string, accentHex: string): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase.from('device_live_activity_tokens')
    .update({ accent_hex: accentHex }).eq('user_id', uid).eq('device_id', deviceId);
  orThrow(error);
}

export async function updateLiveActivityProgress(groupId: string, destinationId: string, state: {
  distanceMeters: number | null; etaSeconds: number | null; progress: number | null; etaTargetAtMs?: number;
}, accentHex?: string, sampledAtMs = Date.now()): Promise<void> {
  const uid = await requireUserId();
  const progress = state.progress;
  if (state.distanceMeters == null || progress == null) return;
  await writeInstallationCapability(uid, async deviceId => {
    const { error } = await supabase.from('live_activity_sessions').update({
    current_distance_m: state.distanceMeters,
    eta_seconds: state.etaSeconds == null ? null : Math.round(state.etaSeconds),
      last_progress_bucket: progressBucket20(progress),
    ...(accentHex ? { accent_hex: accentHex } : {}),
    updated_at: new Date(state.etaTargetAtMs != null && state.etaSeconds != null
      ? state.etaTargetAtMs - Math.max(0, Math.round(state.etaSeconds)) * 1000 : sampledAtMs).toISOString(),
    }).eq('user_id', uid).eq('device_id', deviceId).eq('group_id', groupId).eq('destination_id', destinationId);
    orThrow(error);
  });
}
