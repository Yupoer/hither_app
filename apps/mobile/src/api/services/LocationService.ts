/**
 * LocationService — GPS location upsert for the current user.
 */
import { supabase } from '../supabase';
import { demoUpdateMyLocation, isDemoGroup } from '../demo';
import type { Coordinates } from '../../types';
import { requireUserId, orThrow } from './_helpers';
import { normalizeLocationRefreshRecipientIds } from '../../utils/locationRefreshResponse';

export interface LocationRefreshResult {
  accepted: boolean;
  retryAfterSeconds: number;
  recipientIds: string[];
}

export interface LocationBatchEvent {
  id: string;
  groupId: string;
  navigationSessionId: string | null;
  capturedAt: number;
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
    course?: number | null;
  };
  trackingMode: string;
  source: string;
  sequence: number;
}

export interface LocationBatchResult {
  acceptedIds: string[];
  rejected: Array<{ id: string; reason: string }>;
}

interface LocationRefreshRow {
  accepted?: boolean;
  retry_after_seconds?: number;
  recipient_ids?: unknown;
}

export interface PendingLocationRefresh {
  groupId: string;
  requestedBy: string;
  requestedAt: string;
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

export async function ingestLocationBatch(
  events: LocationBatchEvent[],
): Promise<LocationBatchResult> {
  const acceptedIds: string[] = [];
  const remoteEvents: LocationBatchEvent[] = [];
  for (const event of events) {
    if (isDemoGroup(event.groupId)) {
      demoUpdateMyLocation(event.coords);
      acceptedIds.push(event.id);
    } else {
      remoteEvents.push(event);
    }
  }
  if (remoteEvents.length === 0) return { acceptedIds, rejected: [] };

  await requireUserId();
  const { data, error } = await supabase.rpc('ingest_location_batch', {
    p_events: remoteEvents,
  });
  orThrow(error);
  const result = (data ?? {}) as Partial<LocationBatchResult>;
  return {
    acceptedIds: [...acceptedIds, ...(Array.isArray(result.acceptedIds) ? result.acceptedIds : [])],
    rejected: Array.isArray(result.rejected) ? result.rejected : [],
  };
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
    recipientIds: normalizeLocationRefreshRecipientIds(row.recipient_ids),
  };
}

export async function listMyPendingLocationRefreshes(): Promise<PendingLocationRefresh[]> {
  await requireUserId();
  const { data, error } = await supabase.rpc('list_my_pending_location_refreshes');
  orThrow(error);
  return (Array.isArray(data) ? data : []).flatMap((row) => {
    const value = row as {
      group_id?: unknown;
      requested_by?: unknown;
      requested_at?: unknown;
    };
    return typeof value.group_id === 'string'
      && typeof value.requested_by === 'string'
      && typeof value.requested_at === 'string'
      ? [{
          groupId: value.group_id,
          requestedBy: value.requested_by,
          requestedAt: value.requested_at,
        }]
      : [];
  });
}

export async function ackMyLocationRefresh(
  groupId: string,
  requestedAt: string,
): Promise<boolean> {
  await requireUserId();
  const { data, error } = await supabase.rpc('ack_my_location_refresh', {
    p_group_id: groupId,
    p_requested_at: requestedAt,
  });
  orThrow(error);
  return data === true;
}
