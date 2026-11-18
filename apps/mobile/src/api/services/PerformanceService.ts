import { createDiagnosticSubmissionAbort, getDiagnosticConsentEnabled, getDiagnosticConsentRevision, isDiagnosticConsentCurrent } from '../../state/diagnosticConsent';
import { baseSupabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';
import type { PerformanceUploadRecord } from '../../state/performance';

export async function uploadPerformanceBatch(
  records: PerformanceUploadRecord[],
): Promise<string[]> {
  if (records.length === 0) return [];
  const revision = getDiagnosticConsentRevision();
  if (!(await getDiagnosticConsentEnabled())) return [];
  await requireUserId();
  if (!isDiagnosticConsentCurrent(revision)) return [];
  const submission = createDiagnosticSubmissionAbort(revision);
  const { data, error } = await Promise.resolve(baseSupabase.rpc('ingest_performance_batch', {
    p_events: records.map((record) => ({
      id: record.id,
      sessionId: record.sessionId,
      timestamp: record.timestamp,
      eventType: record.eventType,
      operation: record.operation,
      payload: record.payload,
    })),
  }).abortSignal(submission.signal)).finally(submission.dispose);
  orThrow(error);
  const result = (data ?? {}) as { acceptedIds?: unknown };
  return Array.isArray(result.acceptedIds)
    ? result.acceptedIds.filter((id): id is string => typeof id === 'string')
    : [];
}
