/**
 * Single-flight flush coordinator for location outbox.
 * Multiple FG/BG/heartbeat/manual callers await one in-flight flush.
 */

export type FlushRunner<T> = () => Promise<T>;

/**
 * Create a single-flight wrapper: concurrent calls share the same promise.
 * When the flight settles, the next caller starts a fresh flush.
 */
export function createSingleFlightFlush<T>(run: FlushRunner<T>): {
  flush: () => Promise<T>;
  isInFlight: () => boolean;
} {
  let inFlight: Promise<T> | null = null;

  return {
    isInFlight: () => inFlight != null,
    flush: () => {
      if (inFlight) return inFlight;
      inFlight = Promise.resolve()
        .then(run)
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
