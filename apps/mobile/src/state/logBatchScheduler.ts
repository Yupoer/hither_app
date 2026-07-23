export const LOG_BATCH_RECORD_THRESHOLD = 100;
export const LOG_BATCH_MAX_WAIT_MS = 15 * 60_000;
export const LOG_BATCH_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000] as const;

type Flush = () => Promise<{ sent: number; remaining: number }>;

let flushHandler: Flush | null = null;
let enabled = false;
let writes = 0;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function schedule(delay: number): void {
  if (!enabled || !flushHandler || timer || inFlight) return;
  timer = setTimeout(() => {
    timer = null;
    void runFlush();
  }, delay);
}

async function runFlush(): Promise<void> {
  if (!enabled || !flushHandler || inFlight) return;
  clearTimer();
  const request = flushHandler();
  inFlight = request.then(
    () => undefined,
    () => undefined,
  );
  let result: { sent: number; remaining: number };
  try {
    result = await request;
  } catch {
    result = { sent: 0, remaining: 1 };
  } finally {
    inFlight = null;
  }
  if (!enabled) return;
  writes = 0;
  if (result.remaining <= 0) {
    retry = 0;
    return;
  }
  if (result.sent > 0) {
    retry = 0;
    schedule(LOG_BATCH_MAX_WAIT_MS);
    return;
  }
  const delay = LOG_BATCH_BACKOFF_MS[Math.min(retry, LOG_BATCH_BACKOFF_MS.length - 1)];
  retry += 1;
  schedule(delay);
}

export function configureLogBatchScheduler(flush: Flush): void {
  flushHandler = flush;
}

export function setLogBatchSchedulerEnabled(next: boolean): void {
  enabled = next;
  writes = 0;
  retry = 0;
  clearTimer();
}

export function notifyLogRecorded(): void {
  if (!enabled) return;
  writes += 1;
  if (writes >= LOG_BATCH_RECORD_THRESHOLD) {
    clearTimer();
    // Zero-delay timer is flushable under Jest fake timers (unlike queueMicrotask).
    schedule(0);
  } else {
    schedule(LOG_BATCH_MAX_WAIT_MS);
  }
}

/**
 * Error events should flush ASAP (not wait 15m / 100 records).
 * Debounce with a short delay so a crash-loop does not schedule thrash;
 * inFlight still serializes the actual upload.
 */
export const ERROR_FLUSH_DEBOUNCE_MS = 1_500;

export function notifyErrorRecorded(): void {
  if (!enabled) return;
  writes += 1;
  clearTimer();
  schedule(ERROR_FLUSH_DEBOUNCE_MS);
}

export function stopLogBatchScheduler(): void {
  enabled = false;
  writes = 0;
  retry = 0;
  clearTimer();
}

/** Test helper — resets module state between Jest cases. */
export function __resetLogBatchSchedulerForTests(): void {
  flushHandler = null;
  enabled = false;
  writes = 0;
  retry = 0;
  clearTimer();
  inFlight = null;
}
