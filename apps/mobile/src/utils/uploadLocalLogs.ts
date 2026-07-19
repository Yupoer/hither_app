/**
 * Drain local diagnostic + performance queues to the backend.
 * Used by "同步資料庫" so a single tap also ships on-device logs.
 */

import { diagnostics } from '../state/diagnostics';
import { flushPerformance as flushPerformanceDefault } from '../state/performance';

/** Safety cap: flush() is 100/batch → at most ~5k diagnostic rows per tap. */
export const MAX_DIAGNOSTIC_FLUSH_ROUNDS = 50;
/** Performance flush has no remaining count; retry a few times after first. */
export const MAX_PERFORMANCE_FLUSH_ROUNDS = 3;

export interface UploadLocalLogsResult {
  diagnosticSent: number;
  diagnosticRemaining: number;
  performanceOk: boolean;
}

export interface UploadLocalLogsDeps {
  writeDiagnostic?: (input: {
    event: string;
    source?: string;
    success?: boolean;
    sent?: number;
    remaining?: number;
  }) => Promise<void>;
  flushDiagnostics?: () => Promise<{ sent: number; remaining: number }>;
  flushPerformance?: () => Promise<void>;
  maxDiagnosticRounds?: number;
  maxPerformanceRounds?: number;
  source?: string;
}

/**
 * Flush pending on-device logs. Does not throw on network failure for individual
 * flushes; returns remaining counts so callers can surface partial success.
 */
export async function uploadLocalLogs(
  deps: UploadLocalLogsDeps = {},
): Promise<UploadLocalLogsResult> {
  const write =
    deps.writeDiagnostic ??
    ((input: {
      event: string;
      source?: string;
      success?: boolean;
      sent?: number;
      remaining?: number;
    }) => diagnostics.write(input));
  const flushDiag = deps.flushDiagnostics ?? (() => diagnostics.flush());
  const flushPerf = deps.flushPerformance ?? (() => flushPerformanceDefault());
  const maxDiag = deps.maxDiagnosticRounds ?? MAX_DIAGNOSTIC_FLUSH_ROUNDS;
  const maxPerf = deps.maxPerformanceRounds ?? MAX_PERFORMANCE_FLUSH_ROUNDS;
  const source = deps.source ?? 'destination_reorder_sync';

  await write({
    event: 'manual_log_upload',
    source,
  }).catch(() => undefined);

  let diagnosticSent = 0;
  let diagnosticRemaining = 0;

  for (let round = 0; round < maxDiag; round += 1) {
    let result: { sent: number; remaining: number };
    try {
      result = await flushDiag();
    } catch {
      diagnosticRemaining = -1;
      break;
    }
    diagnosticSent += Math.max(0, result.sent);
    diagnosticRemaining = Math.max(0, result.remaining);
    if (result.remaining <= 0 || result.sent === 0) break;
  }

  let performanceOk = true;
  for (let round = 0; round < maxPerf; round += 1) {
    try {
      await flushPerf();
    } catch {
      performanceOk = false;
      break;
    }
  }

  await write({
    event: 'manual_log_upload_done',
    source,
    success: performanceOk && diagnosticRemaining === 0,
    sent: diagnosticSent,
    remaining: diagnosticRemaining < 0 ? 0 : diagnosticRemaining,
  }).catch(() => undefined);

  return {
    diagnosticSent,
    diagnosticRemaining,
    performanceOk,
  };
}
