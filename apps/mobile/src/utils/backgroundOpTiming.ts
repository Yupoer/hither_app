/**
 * Allow-listed elapsed timing for background journey callbacks.
 * Privacy: stages only — no coordinates, tokens, or free-form PII.
 */

export type BackgroundOpStage =
  | 'config_load'
  | 'async_storage_write'
  | 'live_activity_update'
  | 'diagnostics_write'
  | 'outbox_enqueue'
  | 'outbox_flush'
  | 'session_ack'
  | 'clear_live_activities'
  | 'callback_total';

export type BackgroundOpTimingEntry = {
  stage: BackgroundOpStage;
  elapsedMs: number;
  success: boolean;
};

export type BackgroundOpTimeline = {
  callbackId: string;
  startedAt: number;
  stages: BackgroundOpTimingEntry[];
  totalMs: number;
};

let callbackSeq = 0;

/** Next monotonic callback id for correlation (process-local). */
export function nextBackgroundCallbackId(): string {
  callbackSeq += 1;
  return `bg-${callbackSeq}`;
}

/** Wall-clock elapsed for an async stage. Errors rethrow after recording. */
export async function timeBackgroundStage<T>(
  stages: BackgroundOpTimingEntry[],
  stage: BackgroundOpStage,
  work: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const value = await work();
    stages.push({ stage, elapsedMs: Math.max(0, Date.now() - t0), success: true });
    return value;
  } catch (error) {
    stages.push({ stage, elapsedMs: Math.max(0, Date.now() - t0), success: false });
    throw error;
  }
}

/**
 * Compact stage summary for diagnostics `reason` field (allow-listed string).
 * Format: `bg-N|stage:ms[!],...` — no coords/tokens.
 */
export function compactBackgroundTimeline(timeline: BackgroundOpTimeline): string {
  const parts = timeline.stages.slice(0, 12).map((s) => {
    const fail = s.success ? '' : '!';
    return `${s.stage}:${Math.round(s.elapsedMs)}${fail}`;
  });
  const body = `${timeline.callbackId}|${parts.join(',')}`;
  return body.slice(0, 200);
}

/** True when total elapsed approaches iOS background scene budget (~10s). */
export function exceedsWatchdogBudget(
  totalMs: number,
  budgetMs = 8_000,
): boolean {
  return totalMs >= budgetMs;
}
