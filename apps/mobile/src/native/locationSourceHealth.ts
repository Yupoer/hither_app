export type LocationSourceHealth =
  | { kind: 'waiting' }
  | { kind: 'receiving'; lastCapturedAt: number }
  | { kind: 'interrupted'; message: string }
  | { kind: 'permissionDenied' };

let health: LocationSourceHealth = { kind: 'waiting' };
const listeners = new Set<() => void>();
export function locationSourceHealth(): LocationSourceHealth { return health; }
export function reportLocationSourceHealth(next: LocationSourceHealth): void {
  health = next;
  for (const listener of listeners) listener();
}
export function subscribeLocationSourceHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
