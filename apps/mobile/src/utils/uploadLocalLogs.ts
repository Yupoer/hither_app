/**
 * Bounded single-round diagnostic + performance flush for the opt-in Log lane.
 * Routine upload is owned by logBatchScheduler; this is the flush unit.
 */

import { getDiagnosticConsentEnabled } from '../state/diagnosticConsent';
import { diagnostics } from '../state/diagnostics';
import { flushPerformance as flushPerformanceDefault } from '../state/performance';

export interface UploadLocalLogsResult {
  diagnosticSent: number;
  diagnosticRemaining: number;
  performanceSent: number;
  performanceRemaining: number;
}

export interface UploadLocalLogsDeps {
  getConsent?: () => Promise<boolean>;
  flushDiagnostics?: () => Promise<{ sent: number; remaining: number }>;
  flushPerformance?: () => Promise<{ sent: number; remaining: number }>;
  /** @deprecated no multi-round drain; ignored */
  maxDiagnosticRounds?: number;
  /** @deprecated no multi-round drain; ignored */
  maxPerformanceRounds?: number;
  source?: string;
  writeDiagnostic?: (input: {
    event: string;
    source?: string;
    success?: boolean;
    sent?: number;
    remaining?: number;
  }) => Promise<void>;
}

/**
 * One diagnostic batch and one performance batch per call (≤100 each via flush).
 * Consent off → no network and no queue work.
 */
export async function uploadLocalLogs(
  deps: UploadLocalLogsDeps = {},
): Promise<UploadLocalLogsResult> {
  const consented =
    deps.getConsent != null
      ? await deps.getConsent()
      : await getDiagnosticConsentEnabled();
  if (!consented) {
    return {
      diagnosticSent: 0,
      diagnosticRemaining: 0,
      performanceSent: 0,
      performanceRemaining: 0,
    };
  }

  const flushDiag = deps.flushDiagnostics ?? (() => diagnostics.flush());
  const flushPerf = deps.flushPerformance ?? (() => flushPerformanceDefault());

  let diagnosticSent = 0;
  let diagnosticRemaining = 0;
  try {
    const diagnostic = await flushDiag();
    diagnosticSent = Math.max(0, diagnostic.sent);
    diagnosticRemaining = Math.max(0, diagnostic.remaining);
  } catch {
    diagnosticRemaining = -1;
  }

  let performanceSent = 0;
  let performanceRemaining = 0;
  try {
    const performance = await flushPerf();
    performanceSent = Math.max(0, performance.sent);
    performanceRemaining = Math.max(0, performance.remaining);
  } catch {
    performanceRemaining = -1;
  }

  return {
    diagnosticSent,
    diagnosticRemaining,
    performanceSent,
    performanceRemaining,
  };
}
