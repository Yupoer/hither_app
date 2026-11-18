import { createDiagnosticSubmissionAbort, getDiagnosticConsentEnabled, getDiagnosticConsentRevision, isDiagnosticConsentCurrent } from '../../state/diagnosticConsent';
import type { MetricPayloadFile } from '../../native/metrics';
import { supabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';
import { getOrCreateLiveActivityDeviceId } from './LiveActivityService';

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
): Promise<DiagnosticBatchResult> {
  if (records.length === 0) return { acceptedIds: [], rejected: [] };
  const revision = getDiagnosticConsentRevision();
  if (!(await getDiagnosticConsentEnabled())) return { acceptedIds: [], rejected: [] };
  await requireUserId();
  if (!isDiagnosticConsentCurrent(revision)) return { acceptedIds: [], rejected: [] };
  const deviceId = await getOrCreateLiveActivityDeviceId();
  if (!isDiagnosticConsentCurrent(revision)) return { acceptedIds: [], rejected: [] };
  const submission = createDiagnosticSubmissionAbort(revision);
  const { data, error } = await Promise.resolve(supabase.rpc('ingest_diagnostic_batch', {
    p_events: records.map((record) => ({
      ...record,
      deviceId,
      buildNumber: record.payload.buildNumber ?? 'unknown',
      appVersion: record.payload.appVersion ?? 'unknown',
    })),
  }).abortSignal(submission.signal)).finally(submission.dispose);
  orThrow(error);
  const result = (data ?? {}) as Partial<DiagnosticBatchResult>;
  return {
    acceptedIds: Array.isArray(result.acceptedIds) ? result.acceptedIds : [],
    rejected: Array.isArray(result.rejected) ? result.rejected : [],
  };
}

export async function uploadMetricPayload(input: MetricPayloadFile): Promise<boolean> {
  return (await submitMetricPayload(input, getDiagnosticConsentRevision(), () => true)) === true;
}

async function submitMetricPayload(
  input: MetricPayloadFile,
  revision: number,
  isCurrent: () => boolean,
): Promise<boolean | null> {
  if (!(await getDiagnosticConsentEnabled()) || !isDiagnosticConsentCurrent(revision) || !isCurrent()) return null;
  await requireUserId();
  if (!isDiagnosticConsentCurrent(revision) || !isCurrent()) return null;
  const deviceId = await getOrCreateLiveActivityDeviceId();
  if (!isDiagnosticConsentCurrent(revision) || !isCurrent()) return null;
  const parsed: unknown = JSON.parse(input.json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MetricKit payload must be a JSON object');
  }
  const submission = createDiagnosticSubmissionAbort(revision);
  const { data, error } = await Promise.resolve(supabase.rpc('ingest_metric_payload', {
    p_id: input.id,
    p_device_id: deviceId,
    p_kind: input.kind,
    p_payload: parsed,
    p_received_at: new Date(input.receivedAt).toISOString(),
  }).abortSignal(submission.signal)).finally(submission.dispose);
  orThrow(error);
  return typeof data === 'boolean' ? data : null;
}

/** Drain up to five records while the originating consent and app lifecycle are current. */
export async function uploadMetricPayloadBatch(payloads: MetricPayloadFile[], isCurrent: () => boolean) {
  const revision = getDiagnosticConsentRevision();
  const acceptedIds: string[] = [];
  const expiredIds: string[] = [];
  if (!(await getDiagnosticConsentEnabled()) || !isDiagnosticConsentCurrent(revision) || !isCurrent()) {
    return { acceptedIds, expiredIds };
  }
  for (const payload of payloads.slice(0, 5)) {
    if (!isDiagnosticConsentCurrent(revision) || !isCurrent()) break;
    try {
      const accepted = await submitMetricPayload(payload, revision, isCurrent);
      if (accepted === null) break;
      (accepted ? acceptedIds : expiredIds).push(payload.id);
    } catch { break; }
  }
  return { acceptedIds, expiredIds };
}
