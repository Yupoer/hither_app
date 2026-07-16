import { supabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';
import { getOrCreateLiveActivityDeviceId } from './LiveActivityService';

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

export async function uploadMetricPayload(input: {
  id: string;
  kind: 'metric' | 'diagnostic';
  json: string;
  receivedAt: number;
}): Promise<void> {
  const uid = await requireUserId();
  const deviceId = await getOrCreateLiveActivityDeviceId();
  const parsed: unknown = JSON.parse(input.json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MetricKit payload must be a JSON object');
  }
  const { error } = await supabase.from('metric_payloads').insert({
    id: input.id,
    user_id: uid,
    device_id: deviceId,
    kind: input.kind,
    payload: parsed,
    received_at: new Date(input.receivedAt).toISOString(),
  });
  orThrow(error);
}
