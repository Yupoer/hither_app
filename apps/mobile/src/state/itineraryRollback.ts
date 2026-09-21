import type { Destination } from '../types';
export interface ItineraryRollback { before: Destination[]; after: Destination[]; }
export function operationWirePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const { _localRollback, ...wire } = payload;
  return wire;
}
/** Undo only this operation's changed fields, preserving unrelated newer work. */
export function rollbackItinerary(current: Destination[], rollback: ItineraryRollback): Destination[] {
  const before = new Map(rollback.before.map(item => [item.id, item]));
  const after = new Map(rollback.after.map(item => [item.id, item]));
  const result = current.filter(item => before.has(item.id) || !after.has(item.id)).map(item => {
    const old = before.get(item.id);
    const applied = after.get(item.id);
    if (!old || !applied) return item;
    const next = { ...item } as unknown as Record<string, unknown>;
    for (const field of new Set([...Object.keys(old), ...Object.keys(applied)])) {
      const a = old[field as keyof Destination];
      const b = applied[field as keyof Destination];
      if (JSON.stringify(a) !== JSON.stringify(b) && JSON.stringify(next[field]) === JSON.stringify(b)) {
        if (a === undefined) delete next[field]; else next[field] = a;
      }
    }
    return next as unknown as Destination;
  });
  for (const item of rollback.before) {
    if (!after.has(item.id) && !result.some(next => next.id === item.id)) result.push(item);
  }
  return result.sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || a.order - b.order);
}
