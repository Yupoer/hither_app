import { createDiagnosticSubmissionAbort, getDiagnosticConsentEnabled, getDiagnosticConsentRevision, isDiagnosticConsentCurrent } from '../../state/diagnosticConsent';
import type { MetricPayloadFile } from '../../native/metrics';
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
  const revision = getDiagnosticConsentRevision();
  if (!(await getDiagnosticConsentEnabled())) return { acceptedIds: [], rejected: [] };
  await requireUserId();
  if (!isDiagnosticConsentCurrent(revision)) return { acceptedIds: [], rejected: [] };
  const submission = createDiagnosticSubmissionAbort(revision);
  const { data, error } = await Promise.resolve(supabase.rpc('ingest_diagnostic_batch', {
    p_events: records.map((record) => ({ ...record, ...metadata })),
  }).abortSignal(submission.signal)).finally(submission.dispose);
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
}, revision = getDiagnosticConsentRevision(), isCurrent: () => boolean = () => true): Promise<boolean> {
  if (!(await getDiagnosticConsentEnabled()) || !isDiagnosticConsentCurrent(revision) || !isCurrent()) return false;
  const uid = await requireUserId();
  if (!isDiagnosticConsentCurrent(revision) || !isCurrent()) return false;
  const deviceId = await getOrCreateLiveActivityDeviceId();
  if (!isDiagnosticConsentCurrent(revision) || !isCurrent()) return false;
  const parsed: unknown = JSON.parse(input.json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MetricKit payload must be a JSON object');
  }
  const submission = createDiagnosticSubmissionAbort(revision);
  const { error } = await Promise.resolve(supabase.from('metric_payloads').insert({
    id: input.id,
    user_id: uid,
    device_id: deviceId,
    kind: input.kind,
    payload: parsed,
    received_at: new Date(input.receivedAt).toISOString(),
  }).abortSignal(submission.signal)).finally(submission.dispose);
  orThrow(error);
  return true;
}

/** One existing batch (five payloads), fenced across every asynchronous boundary. */
export async function uploadMetricPayloadBatch(payloads: MetricPayloadFile[], isCurrent: () => boolean): Promise<string[]> {
  const revision = getDiagnosticConsentRevision();
  if (!(await getDiagnosticConsentEnabled()) || !isDiagnosticConsentCurrent(revision) || !isCurrent()) return [];
  const accepted: string[] = [];
  for (const payload of payloads.slice(0, 5)) {
    if (!isDiagnosticConsentCurrent(revision) || !isCurrent()) break;
    try {
      if (!(await uploadMetricPayload(payload, revision, isCurrent))) break;
      accepted.push(payload.id);
    } catch { break; }
  }
  return accepted;
}
