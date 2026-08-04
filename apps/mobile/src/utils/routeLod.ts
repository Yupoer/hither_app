import type { Coordinates } from '../types';

/** Camera state used only by the settled display projection. */
export interface RouteViewport {
  latitude: number;
  longitudeDelta: number;
  widthPx: number;
}

/** Maximum display error measured in pixels at the settled viewport. */
export const DEFAULT_ROUTE_TARGET_PIXEL_ERROR = 1.5;

const METERS_PER_DEGREE_LATITUDE = 110_540;

/**
 * Estimate screen density without asking MapKit for compositor internals.
 * The result is a display-only hint; route distance and ETA never use it.
 */
export function routeMetersPerPixel(viewport: RouteViewport): number {
  const widthPx = Math.max(1, viewport.widthPx);
  const latitudeScale = Math.max(
    0.15,
    Math.cos((Math.max(-85, Math.min(85, viewport.latitude)) * Math.PI) / 180),
  );
  return (
    111_320 * latitudeScale * Math.max(0.000001, viewport.longitudeDelta)
  ) / widthPx;
}

/** Normalize a settled region before it becomes the display projection key. */
export function routeViewportFromRegion(viewport: RouteViewport): RouteViewport {
  return {
    latitude: Number.isFinite(viewport.latitude) ? viewport.latitude : 0,
    longitudeDelta: Math.max(
      0.000001,
      Number.isFinite(viewport.longitudeDelta) ? viewport.longitudeDelta : 1,
    ),
    widthPx: Math.max(1, Number.isFinite(viewport.widthPx) ? viewport.widthPx : 1),
  };
}

/**
 * Derive tolerance directly from the settled viewport. There are no zoom
 * bands or threshold jumps: zooming out increases tolerance continuously and
 * zooming in converges continuously to the complete provider geometry.
 */
export function routeToleranceMeters(
  viewport: RouteViewport,
  targetPixelError = DEFAULT_ROUTE_TARGET_PIXEL_ERROR,
): number {
  const safeTarget = Number.isFinite(targetPixelError)
    ? Math.max(0, targetPixelError)
    : DEFAULT_ROUTE_TARGET_PIXEL_ERROR;
  return routeMetersPerPixel(routeViewportFromRegion(viewport)) * safeTarget;
}

function pointToSegmentMeters(
  point: Coordinates,
  start: Coordinates,
  end: Coordinates,
): number {
  const meanLatitude = ((start.latitude + end.latitude) / 2) * Math.PI / 180;
  const xScale = 111_320 * Math.max(0.15, Math.cos(meanLatitude));
  const endX = (end.longitude - start.longitude) * xScale;
  const endY = (end.latitude - start.latitude) * METERS_PER_DEGREE_LATITUDE;
  const pointX = (point.longitude - start.longitude) * xScale;
  const pointY = (point.latitude - start.latitude) * METERS_PER_DEGREE_LATITUDE;
  const lengthSquared = endX * endX + endY * endY;
  if (lengthSquared === 0) return Math.hypot(pointX, pointY);
  const ratio = Math.max(
    0,
    Math.min(1, (pointX * endX + pointY * endY) / lengthSquared),
  );
  return Math.hypot(pointX - ratio * endX, pointY - ratio * endY);
}

/** Display-only Douglas-Peucker projection. The input is never mutated. */
export function simplifyRoutePointsForDisplay(
  points: readonly Coordinates[],
  toleranceMeters: number,
): Coordinates[] {
  if (points.length <= 2 || toleranceMeters <= 0) return [...points];

  let furthestIndex = -1;
  let furthestDistance = 0;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointToSegmentMeters(points[index]!, start, end);
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestIndex = index;
    }
  }
  if (furthestIndex < 0 || furthestDistance <= toleranceMeters) {
    return [start, end];
  }
  const before = simplifyRoutePointsForDisplay(
    points.slice(0, furthestIndex + 1),
    toleranceMeters,
  );
  const after = simplifyRoutePointsForDisplay(
    points.slice(furthestIndex),
    toleranceMeters,
  );
  return [...before.slice(0, -1), ...after];
}

/**
 * Project provider geometry for a settled viewport. Near zoom deliberately
 * returns every provider point so roundabouts, U-turns, bends and road
 * recesses are not lost. Distance/ETA callers must continue using the raw
 * DirectionsResult, not this function.
 */
export function displayRoutePoints(
  points: readonly Coordinates[],
  viewport: RouteViewport,
): Coordinates[] {
  return simplifyRoutePointsForDisplay(points, routeToleranceMeters(viewport));
}

/** Maximum provider-geometry deviation from the display projection in metres. */
export function maxScreenSpaceErrorMeters(
  source: readonly Coordinates[],
  displayed: readonly Coordinates[],
): number {
  if (source.length === 0) return 0;
  if (displayed.length === 0) return Number.POSITIVE_INFINITY;
  if (displayed.length === 1) {
    return Math.max(...source.map((point) => pointToSegmentMeters(point, displayed[0]!, displayed[0]!)));
  }
  return Math.max(...source.map((point) => {
    let closest = Number.POSITIVE_INFINITY;
    for (let index = 1; index < displayed.length; index += 1) {
      closest = Math.min(
        closest,
        pointToSegmentMeters(point, displayed[index - 1]!, displayed[index]!),
      );
    }
    return closest;
  }));
}
