import type { D6RouteRow } from '../d6Itinerary';

export type D6Point = { x: number; y: number };
export type D6DragBounds = D6Point & { width: number; height: number };
export type D6DragTarget = { kind: 'day'; day: number }
  | { kind: 'row'; id: string; edge: 'above' | 'below' };
export type D6DragGeometry = {
  root: D6DragBounds;
  source: D6DragBounds;
  overlay: D6Point;
  strip: D6DragBounds;
  days: { day: number; bounds: D6DragBounds }[];
  rows: { id: string; bounds: D6DragBounds }[];
};
export type D6DragSession = D6DragGeometry & { row: D6RouteRow; offset: D6Point };
export type D6DragPresentation = {
  token: number;
  sourceId: string;
  geometry: D6DragGeometry;
  offset: D6Point;
};

function contains(bounds: D6DragBounds, point: D6Point) {
  'worklet';
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

export function d6DragTarget(geometry: D6DragGeometry, point: D6Point): D6DragTarget | null {
  'worklet';
  if (!contains(geometry.root, point)) return null;
  if (contains(geometry.strip, point)) {
    const day = geometry.days.find(entry => contains(entry.bounds, point));
    return day ? { kind: 'day', day: day.day } : null;
  }
  if (point.x < geometry.root.x || point.x > geometry.root.x + geometry.root.width) return null;
  const first = geometry.rows[0];
  const last = geometry.rows.at(-1);
  if (!first || !last || point.y < Math.max(first.bounds.y - 16, geometry.strip.y + geometry.strip.height)
    || point.y > Math.min(last.bounds.y + last.bounds.height + 48, geometry.root.y + geometry.root.height)) return null;
  const row = geometry.rows.find(entry => point.y < entry.bounds.y + entry.bounds.height / 2);
  return row ? { kind: 'row', id: row.id, edge: 'above' } : { kind: 'row', id: last.id, edge: 'below' };
}

export function d6DropDestination(session: D6DragSession | null, point: D6Point | undefined,
  currentIds: readonly string[]): D6DragTarget | null {
  if (!session || !point || !currentIds.includes(session.row.id)) return null;
  const target = d6DragTarget(session, point);
  if (target?.kind === 'row' && !currentIds.includes(target.id)) return null;
  return target;
}
