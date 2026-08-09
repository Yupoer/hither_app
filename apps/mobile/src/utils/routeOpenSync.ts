/**
 * Route-sheet open-once sync generation guard (#151 / #154).
 * Close bumps generation so an older in-flight promise cannot write into a newer open session.
 */

export type RouteOpenSyncPhase = 'idle' | 'started' | 'done';

export function bumpRouteOpenSyncGeneration(current: number): number {
  return current + 1;
}

/** True only when the async work still belongs to the open session that started it. */
export function shouldApplyRouteOpenSyncResult(
  startedGeneration: number,
  currentGeneration: number,
): boolean {
  return startedGeneration === currentGeneration;
}
