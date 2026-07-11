/**
 * LocationService — GPS location upsert for the current user.
 */
import { supabase } from '../supabase';
import { demoUpdateMyLocation, isDemoGroup } from '../demo';
import type { Coordinates } from '../../types';
import { requireUserId, orThrow } from './_helpers';

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
