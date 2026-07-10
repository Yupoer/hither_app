import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabase';

/**
 * Self-hosted activity logging (no Sentry/PostHog by design — see
 * `public.activity_logs` in supabase/migrations). Fire-and-forget: callers
 * never `await` `logEvent`, and every failure here is swallowed so logging
 * can never break the feature it's watching.
 *
 * Before login (Onboarding), events queue locally in AsyncStorage and are
 * flushed once a session exists (`flushQueuedEvents`, called from
 * SessionContext after sign-in).
 */

const QUEUE_KEY = 'hither.logQueue.v1';
const QUEUE_MAX = 100;

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
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) {
      const queue = await readQueue();
      await writeQueue(enqueue(queue, { event, payload, ts: new Date().toISOString() }));
      return;
    }
    const { error } = await supabase
      .from('activity_logs')
      .insert({ user_id: userId, event, payload: payload ?? null });
    if (error) console.warn('[activityLog] insert failed', error.message);
  } catch (e) {
    console.warn('[activityLog] logEvent failed', e);
  }
}

/**
 * Flush any events queued before login. Called (not awaited) once a session
 * exists. Any failure mid-flush keeps the remaining (unsent) items queued
 * for the next attempt instead of dropping them.
 */
export async function flushQueuedEvents(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) return;
    let queue = await readQueue();
    while (queue.length > 0) {
      const [item, ...rest] = queue;
      const { error } = await supabase.from('activity_logs').insert({
        user_id: userId,
        event: item.event,
        payload: { ...(item.payload ?? {}), queued_at: item.ts },
      });
      if (error) {
        await writeQueue(queue); // keep this + remaining items for next try
        return;
      }
      queue = rest;
      await writeQueue(queue);
    }
  } catch (e) {
    console.warn('[activityLog] flushQueuedEvents failed', e);
  }
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
