import { supabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';
import { mapApplyRpcResult } from './CoreDataService';
import { mapGroupRecoverySnapshot } from './GroupService';
import { operationWirePayload } from '../../state/itineraryRollback';
import type { ApplyCoreOperationResult, CoreOperation } from '../../types/coreData';
import type { LocationBatchEvent, LocationBatchResult, LocationRefreshResult, PendingLocationRefresh } from './LocationService';

export interface AcceptedLocationReceipt {
  id: string;
  groupId: string;
  capturedAt: number;
  receivedAt: string;
}
export interface GroupRefreshExchange {
  requestPeers?: boolean;
  requestedAt?: string;
  acknowledgements?: { requestedAt: string; eventId: string }[];
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('group_sync_invalid_response');
  return value as Record<string, unknown>;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error('group_sync_invalid_ids');
  return value;
}

export async function exchangeGroup(input: {
  groupId: string; actorId: string; operations: CoreOperation[]; events: LocationBatchEvent[];
  refresh: GroupRefreshExchange; signal?: AbortSignal;
}) {
  if (await requireUserId() !== input.actorId) throw new Error('account_changed');
  const core = input.operations.slice(0, 20).map(operation => ({
    operation_id: operation.id, entity_type: operation.entityType, entity_id: operation.entityId,
    entity_version: operation.entityVersion, operation_type: operation.operationType,
    payload: operationWirePayload(operation.payload), sequence: operation.sequence ?? 0,
    dependency_ids: operation.dependencyIds ?? [], created_at: new Date(operation.createdAt).toISOString(),
  }));
  const events = input.events.slice(0, 50);
  const args = { p_group_id: input.groupId, p_actor_id: input.actorId, p_core_operations: core,
    p_location_events: events, p_refresh: input.refresh };
  while (new TextEncoder().encode(JSON.stringify(args, null, 1)).length > 262144) {
    if (events.length) events.pop();
    else if (core.length > 1) core.pop();
    else throw new Error('group_sync_payload_too_large');
  }
  const query = supabase.rpc('sync_group', args);
  const { data, error } = await (input.signal ? query.abortSignal(input.signal) : query);
  orThrow(error);
  if (await requireUserId() !== input.actorId) throw new Error('account_changed');
  const payload = record(data);
  if (!Array.isArray(payload.coreResults)) throw new Error('group_sync_core_results_missing');
  const coreResults = new Map<string, ApplyCoreOperationResult | 'retry' | 'not_submitted'>();
  for (const value of payload.coreResults) {
    const row = record(value);
    const operation = input.operations.find(operation => operation.id === row.operation_id);
    if (!operation || !core.some(item => item.operation_id === operation.id)) continue;
    if (row.status === 'not_submitted' || row.status === 'retry') coreResults.set(operation.id, row.status);
    else if (row.status === 'accepted' || row.status === 'duplicate' || row.status === 'conflict') {
      if (row.status !== 'conflict' && typeof row.entity_version !== 'number') throw new Error('group_sync_core_version_missing');
      coreResults.set(operation.id, mapApplyRpcResult(operation, row));
    } else throw new Error('group_sync_core_status_invalid');
  }
  const location = record(payload.locationResult);
  const submitted = new Set(events.map(event => event.id));
  if (!Array.isArray(location.rejected)) throw new Error('group_sync_location_rejections_missing');
  const locationResult: LocationBatchResult = {
    acceptedIds: strings(location.acceptedIds).filter(id => submitted.has(id)),
    rejected: location.rejected.map(value => {
      const row = record(value);
      if (typeof row.id !== 'string' || typeof row.reason !== 'string') throw new Error('group_sync_invalid_rejection');
      return { id: row.id, reason: row.reason };
    }).filter(row => submitted.has(row.id)),
    notSubmittedIds: input.events.filter(event => !submitted.has(event.id)).map(event => event.id),
  };
  if (!Array.isArray(payload.locationReceipts) || !Array.isArray(payload.pendingRefreshes)
    || !Array.isArray(payload.refreshAcknowledgements)) throw new Error('group_sync_receipts_missing');
  const locationReceipts: AcceptedLocationReceipt[] = payload.locationReceipts.map(value => {
    const row = record(value);
    if (typeof row.id !== 'string' || row.groupId !== input.groupId || typeof row.capturedAt !== 'number'
      || typeof row.receivedAt !== 'string') throw new Error('group_sync_invalid_receipt');
    return { id: row.id, groupId: input.groupId, capturedAt: row.capturedAt, receivedAt: row.receivedAt };
  });
  const pendingRefreshes: PendingLocationRefresh[] = payload.pendingRefreshes.map(value => {
    const row = record(value);
    if (row.group_id !== input.groupId || typeof row.requested_by !== 'string' || typeof row.requested_at !== 'string') {
      throw new Error('group_sync_invalid_refresh');
    }
    return { groupId: input.groupId, requestedBy: row.requested_by, requestedAt: row.requested_at };
  });
  const refreshAcknowledgements = payload.refreshAcknowledgements.map(value => {
    const row = record(value);
    if (typeof row.requestedAt !== 'string' || typeof row.eventId !== 'string' || typeof row.accepted !== 'boolean') {
      throw new Error('group_sync_invalid_refresh_ack');
    }
    return { requestedAt: row.requestedAt, eventId: row.eventId, accepted: row.accepted };
  });
  let refreshRequest: LocationRefreshResult | null = null;
  if (payload.refreshRequest != null) {
    const row = record(payload.refreshRequest);
    if (typeof row.accepted !== 'boolean' || typeof row.retry_after_seconds !== 'number'
      || (row.requested_at != null && typeof row.requested_at !== 'string')) throw new Error('group_sync_invalid_request');
    refreshRequest = { accepted: row.accepted, retryAfterSeconds: Math.max(0, Math.ceil(row.retry_after_seconds)),
      recipientIds: strings(row.recipient_ids ?? []), requestedAt: row.requested_at ?? undefined };
  }
  return { coreResults, locationResult, recovery: mapGroupRecoverySnapshot(payload.snapshot),
    locationReceipts, pendingRefreshes, refreshAcknowledgements, refreshRequest,
    acknowledgedIds: strings(payload.acknowledgedIds) };
}
