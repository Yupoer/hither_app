import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabase';

/**
 * Self-hosted activity logging (no Sentry/PostHog by design — see
 * `public.activity_logs` in supabase/migrations). Fire-and-forget: callers
 * never `await` `logEvent`, and every failure here is swallowed so logging
 * can never break the feature it's watching.
 *
 * Events always land in a local queue and flush in batches (one multi-row
 * insert) to cut radio chatter. Pre-login queues also flush after sign-in.
 */

const QUEUE_KEY = 'hither.logQueue.v1';
const QUEUE_MAX = 100;
/** Max wait before sending a partial batch. */
const FLUSH_DELAY_MS = 8_000;
/** Flush immediately once this many events are queued. */
const FLUSH_BATCH_SIZE = 8;

interface QueuedEvent {
  event: string;
  payload?: Record<string, unknown>;
  ts: string;
}

/** Append `entry` to `queue`, dropping the oldest entries past QUEUE_MAX. Pure — exported for testing. */
export function enqueue(queue: QueuedEvent[], entry: QueuedEvent): QueuedEvent[] {
  const next = [...queue, entry];
  return next.length > QUEUE_MAX ? next.slice(next.length - QUEUE_MAX) : next;
}

async function readQueue(): Promise<QueuedEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedEvent[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedEvent[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueuedEvents();
  }, FLUSH_DELAY_MS);
}

/** Fire-and-forget: log a product event. Never throws, never awaited by callers. */
export function logEvent(event: string, payload?: Record<string, unknown>): void {
  void logEventAsync(event, payload);
}

/**
 * Log the failure of an operation. Shorthand for the `catch` blocks that pair
 * with an action log — captures the error message so a reported bug can be
 * traced from the cloud `activity_logs` without any UI surface.
 */
export function logError(event: string, e: unknown, extra?: Record<string, unknown>): void {
  logEvent(event, { ...extra, ok: false, error: e instanceof Error ? e.message : String(e) });
}

async function logEventAsync(event: string, payload?: Record<string, unknown>): Promise<void> {
  try {
    // Always queue first — batch insert cuts per-event getSession + HTTP.
    const queue = await readQueue();
    const next = enqueue(queue, {
      event,
      payload,
      ts: new Date().toISOString(),
    });
    await writeQueue(next);
    if (next.length >= FLUSH_BATCH_SIZE) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      void flushQueuedEvents();
    } else {
      scheduleFlush();
    }
  } catch (e) {
    console.warn('[activityLog] logEvent failed', e);
  }
}

/**
 * Flush queued events in a single multi-row insert when possible.
 * Called on a timer, when the batch is full, and after sign-in.
 */
export async function flushQueuedEvents(): Promise<void> {
  if (flushInFlight) {
    await flushInFlight;
    return;
  }
  flushInFlight = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) return;

      let queue = await readQueue();
      if (queue.length === 0) return;

      // One request for the whole batch.
      const rows = queue.map((item) => ({
        user_id: userId,
        event: item.event,
        payload: { ...(item.payload ?? {}), queued_at: item.ts },
      }));
      const { error } = await supabase.from('activity_logs').insert(rows);
      if (error) {
        // Fallback: try one-by-one so a single bad row cannot block forever.
        while (queue.length > 0) {
          const [item, ...rest] = queue;
          const { error: oneErr } = await supabase.from('activity_logs').insert({
            user_id: userId,
            event: item.event,
            payload: { ...(item.payload ?? {}), queued_at: item.ts },
          });
          if (oneErr) {
            await writeQueue(queue);
            return;
          }
          queue = rest;
          await writeQueue(queue);
        }
        return;
      }
      await writeQueue([]);
    } catch (e) {
      console.warn('[activityLog] flushQueuedEvents failed', e);
    } finally {
      flushInFlight = null;
    }
  })();
  await flushInFlight;
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
    logEvent('unhandled_exception', {
      message: error?.message,
      stack: error?.stack?.slice(0, 2000),
      isFatal: !!isFatal,
    });
    originalHandler(error, isFatal);
  });
}
