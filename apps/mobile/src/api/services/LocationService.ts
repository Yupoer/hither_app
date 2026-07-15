/**
 * LocationService — GPS location upsert for the current user.
 */
import { supabase } from '../supabase';
import { demoUpdateMyLocation, isDemoGroup } from '../demo';
import type { Coordinates } from '../../types';
import { requireUserId, orThrow } from './_helpers';

export interface LocationRefreshResult {
  accepted: boolean;
  retryAfterSeconds: number;
}

interface LocationRefreshRow {
  accepted?: boolean;
  retry_after_seconds?: number;
}

export async function updateMyLocation(
  coordinates: Coordinates,
  groupId: string,
): Promise<void> {
  if (isDemoGroup(groupId)) {
    demoUpdateMyLocation(coordinates);
    return;
  }
  const uid = await requireUserId();
  const { error } = await supabase.from('member_locations').upsert(
    {
      group_id: groupId,
      user_id: uid,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'group_id,user_id' },
  );
  orThrow(error);
}

export async function requestGroupLocationRefresh(
  groupId: string,
): Promise<LocationRefreshResult> {
  await requireUserId();
  const { data, error } = await supabase.rpc('request_group_location_refresh', {
    p_group_id: groupId,
  });
  orThrow(error);

  const row = (data ?? {}) as LocationRefreshRow;
  return {
    accepted: row.accepted === true,
    retryAfterSeconds: Math.max(0, Math.ceil(row.retry_after_seconds ?? 0)),
  };
}
