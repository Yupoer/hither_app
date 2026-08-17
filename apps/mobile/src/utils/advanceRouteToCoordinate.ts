import type { Coordinates } from '../types';
import { distanceMeters } from './geo';

const METERS_PER_DEGREE_LATITUDE = 110_540;
const METERS_PER_DEGREE_LONGITUDE = 111_320;
const PASSED_END_M = 8;
const SAME_POINT_M = 0.75;

interface SegmentProjection {
  index: number;
  t: number;
  unclampedT: number;
  distanceM: number;
  point: Coordinates;
}

function projectOntoSegment(
  point: Coordinates,
  start: Coordinates,
  end: Coordinates,
): Omit<SegmentProjection, 'index'> {
  const meanLatitude = ((start.latitude + end.latitude) / 2) * Math.PI / 180;
  const xScale = METERS_PER_DEGREE_LONGITUDE * Math.max(0.15, Math.cos(meanLatitude));
  const endX = (end.longitude - start.longitude) * xScale;
  const endY = (end.latitude - start.latitude) * METERS_PER_DEGREE_LATITUDE;
  const pointX = (point.longitude - start.longitude) * xScale;
  const pointY = (point.latitude - start.latitude) * METERS_PER_DEGREE_LATITUDE;
  const lengthSquared = endX * endX + endY * endY;
  if (lengthSquared === 0) {
    return { t: 0, unclampedT: 0, distanceM: Math.hypot(pointX, pointY), point: start };
  }
  const unclampedT = (pointX * endX + pointY * endY) / lengthSquared;
  const t = Math.max(0, Math.min(1, unclampedT));
  const projected: Coordinates = {
    latitude: start.latitude + t * (end.latitude - start.latitude),
    longitude: start.longitude + t * (end.longitude - start.longitude),
  };
  return {
    t,
    unclampedT,
    distanceM: Math.hypot(pointX - t * endX, pointY - t * endY),
    point: projected,
  };
}

function nearestForwardProjection(
  points: readonly Coordinates[],
  coord: Coordinates,
): SegmentProjection | null {
  let best: SegmentProjection | null = null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const projected = projectOntoSegment(coord, points[index]!, points[index + 1]!);
    if (!best || projected.distanceM < best.distanceM) {
      best = { index, ...projected };
    }
  }
  return best;
}

function pushUnique(out: Coordinates[], point: Coordinates): void {
  const last = out[out.length - 1];
  if (last && distanceMeters(last, point) < SAME_POINT_M) return;
  out.push(point);
}

/**
 * Display-only: splice the current GPS sample onto the remaining polyline
 * without waiting for a network directions refresh.
 */
export function advanceRouteToCoordinate(
  points: readonly Coordinates[],
  coord: Coordinates,
): Coordinates[] {
  if (points.length === 0) return [];
  if (!Number.isFinite(coord.latitude) || !Number.isFinite(coord.longitude)) {
    return points.slice();
  }
  if (points.length === 1) {
    if (distanceMeters(coord, points[0]!) < PASSED_END_M) return [];
    return [coord, points[0]!];
  }

  const nearest = nearestForwardProjection(points, coord);
  if (!nearest) return points.slice();

  const last = points[points.length - 1]!;
  const onFinalSegment = nearest.index === points.length - 2;
  if (
    onFinalSegment
    && (nearest.unclampedT >= 1 || distanceMeters(coord, last) < PASSED_END_M)
  ) {
    return [];
  }

  const remaining = points.slice(nearest.index + 1);
  const out: Coordinates[] = [];
  pushUnique(out, coord);
  if (nearest.t < 0.99 && distanceMeters(nearest.point, coord) >= SAME_POINT_M) {
    pushUnique(out, nearest.point);
  }
  for (const point of remaining) {
    pushUnique(out, point);
  }
  return out;
}
