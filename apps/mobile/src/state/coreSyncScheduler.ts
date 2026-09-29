export interface CoreSyncAttempt {
  sent: number;
  duplicates: number;
  remaining: number;
}
/** One bounded foreground worker. Backoff eligibility remains owned by the queue. */
export function createCoreSyncScheduler(flush: () => Promise<CoreSyncAttempt>, foreground = true) {
  let active = foreground;
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let wakeRequested = false;
  let emptyWakeFlushConsumed = false;
  const schedule = (delay: number) => {
    if (stopped || !active || timer || running) return;
    timer = setTimeout(() => { timer = undefined; void run(); }, delay);
  };
  const run = async () => {
    if (stopped || !active || running) return;
    running = true;
    let next: number | null = null;
    try {
      const result = await flush();
      failures = 0;
      if (result.remaining > 0) {
        emptyWakeFlushConsumed = false;
        next = result.sent + result.duplicates > 0 ? 500 : 30_000;
      }
    } catch {
      next = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures++, 5));
    } finally {
      running = false;
      const wokeDuringFlush = wakeRequested;
      wakeRequested = false;
      if (wokeDuringFlush && next === 30_000) {
        // A newly enqueued operation may be immediately eligible even when an
        // older head was waiting on per-operation backoff. The queue remains
        // the authority on eligibility, so this short retry cannot storm the
        // network.
        next = 500;
      } else if (wokeDuringFlush && next === null && !emptyWakeFlushConsumed) {
        // Outbox status notifications can arrive while the final flush is
        // running. Allow one follow-up read to catch work inserted during it,
        // then stop even if that empty read notifies itself again.
        next = 500;
        emptyWakeFlushConsumed = true;
      } else if (next === null) {
        emptyWakeFlushConsumed = false;
      }
      if (next !== null) schedule(next);
    }
  };
  return {
    wake: () => {
      if (running) wakeRequested = true;
      else {
        // New work or connectivity must not wait behind an unrelated group's
        // scheduler delay. Per-operation retry eligibility still prevents a storm.
        emptyWakeFlushConsumed = false;
        clearTimeout(timer);
        timer = undefined;
        schedule(500);
      }
    },
    setForeground: (value: boolean) => {
      active = value;
      if (!active) { clearTimeout(timer); timer = undefined; }
      else schedule(500);
    },
    stop: () => { stopped = true; clearTimeout(timer); timer = undefined; },
  };
}
