import { operationWirePayload } from '../../state/itineraryRollback';
/**
 * Remote apply for OTA-04 core operations (Supabase).
 * Transport is replaceable; semantics match createLocalCoreOperationApplicator.
 */

import type {
  ApplyCoreOperationResult,
  CoreConflictResult,
  CoreEntityType,
  CoreOperation,
} from '../../types/coreData';
import { supabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';

interface ApplyRpcRow {
  status: string;
  operation_id: string;
  entity_version?: number;
  entity?: unknown;
  effects?: Record<string, unknown>;
  conflict?: {
    code?: string;
    message?: string;
    server_entity_version?: number;
    server_state?: unknown;
  };
}

export interface CoreEntityVersionRow {
  groupId: string;
  entityType: CoreEntityType;
  entityId: string;
  entityVersion: number;
  state: unknown;
}

function mapConflict(
  operation: CoreOperation,
  conflict: ApplyRpcRow['conflict'],
): CoreConflictResult {
  const terminalCodes = new Set(['operation_identity_mismatch', 'session_required', 'session_deleted',
    'session_closed', 'session_mismatch', 'not_session_member', 'history_not_correctable',
    'target_deleted', 'scope_mismatch', 'scope_deleted', 'dependency_failed', 'operation_expired']);
  return {
    code: terminalCodes.has(conflict?.code ?? '') ? 'validation' :
      conflict?.code === 'stale_version'
      || conflict?.code === 'invalid_transition'
      || conflict?.code === 'unauthorized'
      || conflict?.code === 'validation'
      || conflict?.code === 'dependency_missing'
      || conflict?.code === 'account_changed'
        ? conflict.code
        : 'unknown',
    message: conflict?.message ?? 'core operation conflict',
    serverEntityVersion: conflict?.server_entity_version,
    serverState: conflict?.server_state,
    operationId: operation.id,
    entityType: operation.entityType,
    entityId: operation.entityId,
    occurredAt: Date.now(),
  };
}

export async function applyCoreOperation(
  operation: CoreOperation,
): Promise<ApplyCoreOperationResult> {
  // Actor-bound rows use the durable ledger RPC. The legacy path remains for
  // already-shipped clients and actorless unit fixtures.
  if (operation.actorId) {
    // Authentication/session recovery is transport state, not a mutation
    // conflict. Let the typed session/network error reach the outbox so it can
    // pause or back off while preserving this durable draft. Only the explicit
    // actor mismatch below is a visible account-bound conflict.
    const actorId = await requireUserId();
    if (actorId !== operation.actorId) {
      return {
        status: 'conflict',
        operationId: operation.id,
        conflict: mapConflict(operation, {
          code: 'account_changed',
          message: 'operation belongs to another authenticated actor',
        }),
      };
    }
    const { data, error } = await supabase.rpc('apply_core_operation_v3', {
      p_operation_id: operation.id,
      p_group_id: operation.groupId,
      p_actor_id: operation.actorId,
      p_entity_type: operation.entityType,
      p_entity_id: operation.entityId,
      p_entity_version: operation.entityVersion,
      p_operation_type: operation.operationType,
      p_payload: operationWirePayload(operation.payload),
      p_sequence: operation.sequence ?? 0,
      p_dependency_ids: operation.dependencyIds ?? [],
      p_created_at: new Date(operation.createdAt).toISOString(),
    });
    orThrow(error);
    return mapApplyRpcResult(operation, data);
  }
  if (operation.operationType === 'record_arrival') {
    try {
      const actorId = await requireUserId();
      if (actorId !== operation.payload.actorId) {
        throw Object.assign(new Error('抵達紀錄所屬帳號已變更'), { code: '42501' });
      }
      const { error: arrivalError } = await supabase.rpc('set_destination_arrival_at', {
        p_destination_id: operation.entityId,
        p_target_user_id: operation.payload.userId as string,
        p_arrived: operation.payload.arrived !== false,
        p_arrived_at: operation.payload.arrivedAt as string,
      });
      orThrow(arrivalError);
      const { data: destination, error } = await supabase.from('itinerary_items')
        .select('closed_at').eq('id', operation.entityId).eq('group_id', operation.groupId).single();
      orThrow(error);
      return { status: 'accepted', operationId: operation.id, entityVersion: 0,
        entity: {
          completeSolo: operation.payload.arrived !== false && Boolean(destination?.closed_at),
        } };
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === '42501' || code === 'P0001' || code === 'P0002' || code === '28000'
        || code === 'PGRST116' || code === 'PGRST301' || code === 'PGRST302'
        || code === 'session_missing_or_expired'
        || /^(22|23)/.test(code ?? '')) {
        return { status: 'conflict', operationId: operation.id,
          conflict: mapConflict(operation, { code: 'unauthorized', message: (error as Error).message }) };
      }
      throw error;
    }
  }
  const rpcName = operation.operationType === 'switch_gathering'
    ? 'apply_leader_gathering_switch'
    : 'apply_core_operation';
  const rpcArgs = operation.operationType === 'switch_gathering'
    ? {
        p_operation_id: operation.id,
        p_group_id: operation.groupId,
        p_entity_id: operation.entityId,
        p_entity_version: operation.entityVersion,
        p_destination_id: operation.payload.activeDestinationId,
        p_created_at: new Date(operation.createdAt).toISOString(),
      }
    : {
        p_operation_id: operation.id,
        p_group_id: operation.groupId,
        p_entity_type: operation.entityType,
        p_entity_id: operation.entityId,
        p_entity_version: operation.entityVersion,
        p_operation_type: operation.operationType,
        p_payload: operationWirePayload(operation.payload),
        p_created_at: new Date(operation.createdAt).toISOString(),
      };
  const { data, error } = await supabase.rpc(rpcName, rpcArgs);
  orThrow(error);

  const row = (Array.isArray(data) ? data[0] : data) as ApplyRpcRow | null;
  if (!row || typeof row !== 'object') {
    throw new Error('apply_core_operation returned empty result');
  }

  if (row.status === 'accepted') {
    return {
      status: 'accepted',
      operationId: row.operation_id ?? operation.id,
      entityVersion: row.entity_version ?? operation.entityVersion + 1,
      entity: row.entity,
      effects: row.effects,
    };
  }
  if (row.status === 'duplicate') {
    return {
      status: 'duplicate',
      operationId: row.operation_id ?? operation.id,
      entityVersion: row.entity_version ?? operation.entityVersion,
      entity: row.entity,
      effects: row.effects,
    };
  }
  return {
    status: 'conflict',
    operationId: row.operation_id ?? operation.id,
    conflict: mapConflict(operation, row.conflict),
  };
}

function mapApplyRpcResult(
  operation: CoreOperation,
  data: unknown,
): ApplyCoreOperationResult {
  const row = (Array.isArray(data) ? data[0] : data) as ApplyRpcRow | null;
  if (!row || typeof row !== 'object') {
    throw new Error('apply_core_operation_v2 returned empty result');
  }
  if (row.status === 'accepted') {
    return {
      status: 'accepted',
      operationId: row.operation_id ?? operation.id,
      entityVersion: row.entity_version ?? operation.entityVersion + 1,
      entity: row.entity,
      effects: row.effects,
    };
  }
  if (row.status === 'duplicate') {
    return {
      status: 'duplicate',
      operationId: row.operation_id ?? operation.id,
      entityVersion: row.entity_version ?? operation.entityVersion,
      entity: row.entity,
      effects: row.effects,
    };
  }
  return {
    status: 'conflict',
    operationId: row.operation_id ?? operation.id,
    conflict: mapConflict(operation, row.conflict),
  };
}

/** Load authoritative entity versions for a group (after remote state fetch). */
export async function fetchCoreEntityVersions(
  groupId: string,
): Promise<CoreEntityVersionRow[]> {
  const { data, error } = await supabase
    .from('core_entity_versions')
    .select('group_id, entity_type, entity_id, entity_version, state')
    .eq('group_id', groupId);
  orThrow(error);
  return ((data ?? []) as Array<{
    group_id: string;
    entity_type: string;
    entity_id: string;
    entity_version: number;
    state: unknown;
  }>).map((row) => ({
    groupId: row.group_id,
    entityType: row.entity_type as CoreEntityType,
    entityId: row.entity_id,
    entityVersion: row.entity_version,
    state: row.state,
  }));
}
