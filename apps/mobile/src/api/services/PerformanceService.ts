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
  const userId = await requireUserId();
  if (!isDiagnosticConsentCurrent(revision)) return [];
  const submission = createDiagnosticSubmissionAbort(revision);
  const { error } = await Promise.resolve(baseSupabase.from('performance_events').upsert(
    records.map((record) => ({
      id: record.id,
      user_id: userId,
      session_id: record.sessionId,
      occurred_at: new Date(record.timestamp).toISOString(),
      event_type: record.eventType,
      operation: record.operation,
      payload: record.payload,
    })),
    { onConflict: 'id', ignoreDuplicates: true },
  ).abortSignal(submission.signal)).finally(submission.dispose);
  orThrow(error);
  return records.map((record) => record.id);
}
