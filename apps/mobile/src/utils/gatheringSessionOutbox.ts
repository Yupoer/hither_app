/**
 * What to do with an optimistic start_gathering outbox after legacy startSession.
 *
 * - flush: navigation_sessions exists — safe to submit gathering Start
 * - keep_pending: transient offline — do NOT flush (session row missing);
 *   reconnect/foreground may drain only after session-start is available
 * - abort: business rejection — mark conflict and restore pre-Start gathering
 */
export type GatheringOutboxAfterSession = 'flush' | 'keep_pending' | 'abort';

/**
 * Pure classifier (no network I/O). Call sites pass `isNetworkRequestError`
 * so this module stays free of RN/supabase import graphs.
 */
export function resolveGatheringOutboxAfterSessionStart(
  result: { ok: true } | { ok: false; isNetworkError: boolean },
): GatheringOutboxAfterSession {
  if (result.ok) return 'flush';
  if (result.isNetworkError) return 'keep_pending';
  return 'abort';
}
