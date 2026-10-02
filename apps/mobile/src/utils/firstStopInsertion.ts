import type { Destination } from '../types';

/** Insert before open stops, retaining the starting stay and completed history. */
export function insertFirstStop(destinations: Destination[], destination: Destination): Destination[] {
  if (destinations.some(item => item.id === destination.id)) return destinations;
  const sameDay = destinations.filter(item => item.day === destination.day
    && (item.subgroupId ?? null) === (destination.subgroupId ?? null)).sort((a, b) => a.order - b.order);
  const firstStop = sameDay.find(item => !item.closedAt && item.kind !== 'accommodation');
  const tail = sameDay.at(-1);
  const order = firstStop?.order ?? (sameDay.length > 1 && tail?.kind === 'accommodation' && tail.stayAnchor
    ? tail.order : (tail?.order ?? -1) + 1);
  const ids = new Set(sameDay.map(item => item.id));
  return [...destinations.map(item => ids.has(item.id) && item.order >= order
    ? { ...item, order: item.order + 1 } : item), { ...destination, order }];
}
