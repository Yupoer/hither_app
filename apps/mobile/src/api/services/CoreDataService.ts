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
import { orThrow } from './_helpers';

interface ApplyRpcRow {
  status: string;
  operation_id: string;
  entity_version?: number;
  entity?: unknown;
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
  return {
    code:
      conflict?.code === 'stale_version'
      || conflict?.code === 'invalid_transition'
      || conflict?.code === 'unauthorized'
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
  const { data, error } = await supabase.rpc('apply_core_operation', {
    p_operation_id: operation.id,
    p_group_id: operation.groupId,
    p_entity_type: operation.entityType,
    p_entity_id: operation.entityId,
    p_entity_version: operation.entityVersion,
    p_operation_type: operation.operationType,
    p_payload: operation.payload,
    p_created_at: new Date(operation.createdAt).toISOString(),
  });
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
    };
  }
  if (row.status === 'duplicate') {
    return {
      status: 'duplicate',
      operationId: row.operation_id ?? operation.id,
      entityVersion: row.entity_version ?? operation.entityVersion,
      entity: row.entity,
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
