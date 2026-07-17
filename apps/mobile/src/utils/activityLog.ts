import type * as Performance from '../state/performance';

declare const require: (moduleName: string) => typeof Performance;

function performanceModule(): typeof Performance {
  return require('../state/performance');
}

interface QueuedEvent {
  event: string;
  payload?: Record<string, unknown>;
  ts: string;
}

/** Pure queue helper kept for compatibility with existing unit coverage. */
export function enqueue(queue: QueuedEvent[], entry: QueuedEvent): QueuedEvent[] {
  const next = [...queue, entry];
  return next.length > 100 ? next.slice(next.length - 100) : next;
}

/** Convert the old action log call sites into bounded performance spans. */
export function logEvent(event: string, payload?: Record<string, unknown>): void {
  performanceModule().markInteraction(event, payload);
}

/** Store only a sanitized error code/span; never persist error text or stacks. */
export function logError(event: string, error: unknown, extra?: Record<string, unknown>): void {
  void performanceModule().recordPerformanceError(event, error, extra);
}

/** Compatibility hook used after auth; it now flushes the performance queue. */
export async function flushQueuedEvents(): Promise<void> {
  await performanceModule().flushPerformance();
}

let globalErrorLoggerInstalled = false;

/** Install a global JS-exception logger (RN's ErrorUtils). Idempotent. */
export function installGlobalErrorLogger(): void {
  if (globalErrorLoggerInstalled) return;
  globalErrorLoggerInstalled = true;
  const errorUtils = (global as unknown as { ErrorUtils?: {
    getGlobalHandler: () => (error: Error, isFatal?: boolean) => void;
    setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
  } }).ErrorUtils;
  if (!errorUtils) return;
  const originalHandler = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    void performanceModule().recordPerformanceError('unhandled_exception', error, { isFatal: !!isFatal });
    originalHandler(error, isFatal);
  });
}
