import { supabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';

export interface DiagnosticUploadMetadata {
  deviceId: string;
  buildNumber: string;
  appVersion: string;
}

export interface DiagnosticUploadRecord {
  id: string;
  timestamp: number;
  sessionId: string;
  event: string;
  navigationSessionId: string | null;
  payload: Record<string, string | number | boolean>;
}

export interface DiagnosticBatchResult {
  acceptedIds: string[];
  rejected: Array<{ id: string; reason: string }>;
}

export async function ingestDiagnosticBatch(
  records: DiagnosticUploadRecord[],
  metadata: DiagnosticUploadMetadata,
): Promise<DiagnosticBatchResult> {
  if (records.length === 0) return { acceptedIds: [], rejected: [] };
  await requireUserId();
  const { data, error } = await supabase.rpc('ingest_diagnostic_batch', {
    p_events: records.map((record) => ({ ...record, ...metadata })),
  });
  orThrow(error);
  const result = (data ?? {}) as Partial<DiagnosticBatchResult>;
  return {
    acceptedIds: Array.isArray(result.acceptedIds) ? result.acceptedIds : [],
    rejected: Array.isArray(result.rejected) ? result.rejected : [],
  };
}
