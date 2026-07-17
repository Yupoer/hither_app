import { baseSupabase } from '../supabase';
import { orThrow, requireUserId } from './_helpers';
import type { PerformanceUploadRecord } from '../../state/performance';

export async function uploadPerformanceBatch(
  records: PerformanceUploadRecord[],
): Promise<string[]> {
  if (records.length === 0) return [];
  const userId = await requireUserId();
  const { error } = await baseSupabase.from('performance_events').insert(
    records.map((record) => ({
      id: record.id,
      user_id: userId,
      session_id: record.sessionId,
      occurred_at: new Date(record.timestamp).toISOString(),
      event_type: record.eventType,
      operation: record.operation,
      payload: record.payload,
    })),
  );
  orThrow(error);
  return records.map((record) => record.id);
}
