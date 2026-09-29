/** Healthy Realtime needs only a consistency check; outages must not cause a polling storm. */
export function groupSyncDelay(realtimeReady: boolean, failures: number): number {
  return realtimeReady ? 300_000 : Math.min(900_000, 60_000 * 2 ** Math.min(4, Math.max(0, failures)));
}
