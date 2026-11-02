/**
 * LocationService — GPS location upsert for the current user.
 */
import { supabase } from '../supabase';
import { demoUpdateMyLocation, isDemoGroup } from '../demo';
import type { Coordinates } from '../../types';
import { requireUserId, orThrow } from './_helpers';
import { captureLocationAccess, isLocationAccessCurrent } from '../../state/locationPrivacy';
import { normalizeLocationSequence } from '../../utils/locationSequence';

export interface LocationRefreshResult {
  accepted: boolean;
  retryAfterSeconds: number;
  recipientIds: string[];
  requestedAt?: string;
}

export interface LocationBatchEvent {
  actorId?: string;
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
  notSubmittedIds?: string[];
  acceptedIds: string[];
  rejected: Array<{ id: string; reason: string }>;
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
  const access = await captureLocationAccess(groupId, true);
  if (!access) return;
  if (isDemoGroup(groupId)) {
    demoUpdateMyLocation(coordinates);
    return;
  }
  const uid = await requireUserId();
  if (!isLocationAccessCurrent(access)) return;
  const { error } = await supabase.from('member_locations').upsert(
    {
      group_id: groupId,
      user_id: uid,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      captured_at: new Date().toISOString(),
    },
    { onConflict: 'group_id,user_id' },
  ).abortSignal(access.signal);
  orThrow(error);
}

export async function ingestLocationBatch(
  events: LocationBatchEvent[],
): Promise<LocationBatchResult> {
  const access = await captureLocationAccess(undefined, true);
  if (access === undefined) return { acceptedIds: [], rejected: events.map(event => ({ id: event.id, reason: 'retryable' })) };
  const denied = (rows: LocationBatchEvent[]) => rows.map(event => ({ id: event.id, reason: 'local_location_access_denied' }));
  if (!access) return { acceptedIds: [], rejected: denied(events) };
  const rejected = denied(events.filter(event => event.groupId !== access.groupId));
  const acceptedIds: string[] = [];
  const remoteEvents: LocationBatchEvent[] = [];
  for (const event of events) {
    if (event.groupId !== access.groupId) continue;
    if (isDemoGroup(event.groupId)) {
      demoUpdateMyLocation(event.coords);
      acceptedIds.push(event.id);
    } else {
      remoteEvents.push(event);
    }
  }
  if (remoteEvents.length === 0) return { acceptedIds, rejected };

  const uid = await requireUserId();
  if (!isLocationAccessCurrent(access)) return { acceptedIds: [], rejected: denied(events) };
  const owned = remoteEvents.filter(event => !event.actorId || event.actorId === uid);
  rejected.push(...remoteEvents.filter(event => event.actorId && event.actorId !== uid).map(event => ({ id: event.id, reason: 'actor_changed' })));
  // Normalize again at the wire boundary for durable rows saved before this fix
  // and direct callers. Keep capturedAt intact for precise server ordering.
  const uploadEvents: LocationBatchEvent[] = [];
  for (const event of owned) {
    try {
      uploadEvents.push({ ...event, sequence: normalizeLocationSequence(event.sequence) });
    } catch {
      rejected.push({ id: event.id, reason: 'invalid_event' });
    }
  }
  if (!uploadEvents.length) return { acceptedIds, rejected };
  const { data, error } = await supabase.rpc('ingest_location_batch', {
    p_events: uploadEvents,
  }).abortSignal(access.signal);
  orThrow(error);
  const result = (data ?? {}) as Partial<LocationBatchResult>;
  return {
    acceptedIds: [...acceptedIds, ...(Array.isArray(result.acceptedIds) ? result.acceptedIds : [])],
    rejected: [...rejected, ...(Array.isArray(result.rejected) ? result.rejected : [])],
  };
}

export async function requestGroupLocationRefresh(
  groupId: string,
): Promise<LocationRefreshResult> {
  const { syncGroup } = await import('../../state/groupSync');
  const result = (await syncGroup({ groupId, refresh: { requestPeers: true } })).refreshRequest;
  if (!result) throw new Error('group_sync_refresh_request_missing');
  return result;
}

export async function listMyPendingLocationRefreshes(): Promise<PendingLocationRefresh[]> {
  const access = await captureLocationAccess();
  if (!access) return [];
  const { syncGroup } = await import('../../state/groupSync');
  return (await syncGroup({ groupId: access.groupId })).pendingRefreshes;
}

export async function ackMyLocationRefresh(groupId: string, requestedAt: string, eventId?: string): Promise<boolean> {
  if (!eventId) throw new Error('location_refresh_receipt_required');
  const { syncGroup } = await import('../../state/groupSync');
  const result = await syncGroup({ groupId, refresh: { acknowledgements: [{ requestedAt, eventId }] } });
  return result.refreshAcknowledgements.some(row => row.requestedAt === requestedAt && row.eventId === eventId && row.accepted);
}

/** Only explicit recipient ACKs for this request version count as responses. */
export async function getGroupLocationRefreshAcknowledgements(
  groupId: string, requestedAt: string,
): Promise<string[]> {
  const { syncGroup } = await import('../../state/groupSync');
  return (await syncGroup({ groupId, refresh: { requestedAt } })).acknowledgedIds;
}
