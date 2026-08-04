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
const METERS_PER_DEGREE_LONGITUDE = 111_320;
const HIGH_CURVATURE_TURN_DEGREES = 40;
const U_TURN_MIN_TURN_DEGREES = 135;
const ROUNDABOUT_MIN_TURN_DEGREES = 8;
const ROUNDABOUT_MIN_TURNS = 3;
const ROUNDABOUT_MIN_TOTAL_TURN_DEGREES = 90;

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
  const longitudeDelta = Number.isFinite(viewport.longitudeDelta)
    ? Math.max(0, viewport.longitudeDelta)
    : 1;
  return (
    METERS_PER_DEGREE_LONGITUDE * latitudeScale * longitudeDelta
  ) / widthPx;
}

/** Normalize a settled region before it becomes the display projection key. */
export function routeViewportFromRegion(viewport: RouteViewport): RouteViewport {
  return {
    latitude: Number.isFinite(viewport.latitude) ? viewport.latitude : 0,
    longitudeDelta: Number.isFinite(viewport.longitudeDelta)
      ? Math.max(0, viewport.longitudeDelta)
      : 1,
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

function localVectorMeters(start: Coordinates, end: Coordinates): { x: number; y: number } {
  const meanLatitude = ((start.latitude + end.latitude) / 2) * Math.PI / 180;
  return {
    x: (end.longitude - start.longitude)
      * METERS_PER_DEGREE_LONGITUDE
      * Math.max(0.15, Math.cos(meanLatitude)),
    y: (end.latitude - start.latitude) * METERS_PER_DEGREE_LATITUDE,
  };
}

function turnAt(
  points: readonly Coordinates[],
  index: number,
): { angleDegrees: number; direction: -1 | 0 | 1 } | null {
  const incoming = localVectorMeters(points[index - 1]!, points[index]!);
  const outgoing = localVectorMeters(points[index]!, points[index + 1]!);
  const incomingLength = Math.hypot(incoming.x, incoming.y);
  const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
  if (incomingLength === 0 || outgoingLength === 0) return null;

  const cosine = Math.max(
    -1,
    Math.min(
      1,
      (incoming.x * outgoing.x + incoming.y * outgoing.y)
        / (incomingLength * outgoingLength),
    ),
  );
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  return {
    angleDegrees: Math.acos(cosine) * 180 / Math.PI,
    direction: cross === 0 ? 0 : cross > 0 ? 1 : -1,
  };
}

function collectRoundaboutAnchors(
  points: readonly Coordinates[],
  anchors: Set<number>,
): void {
  let runStart = -1;
  let runEnd = -1;
  let runDirection: -1 | 0 | 1 = 0;
  let runTurns = 0;
  let runTotalTurn = 0;

  const flush = () => {
    if (
      runTurns >= ROUNDABOUT_MIN_TURNS
      && runTotalTurn >= ROUNDABOUT_MIN_TOTAL_TURN_DEGREES
    ) {
      // Keep the whole same-direction turn run. This protects the visible
      // entry, arc and exit of a roundabout from a single chord.
      for (let index = Math.max(1, runStart - 1); index <= Math.min(points.length - 2, runEnd + 1); index += 1) {
        anchors.add(index);
      }
    }
    runStart = -1;
    runEnd = -1;
    runDirection = 0;
    runTurns = 0;
    runTotalTurn = 0;
  };

  for (let index = 1; index < points.length - 1; index += 1) {
    const turn = turnAt(points, index);
    if (
      !turn
      || turn.direction === 0
      || turn.angleDegrees < ROUNDABOUT_MIN_TURN_DEGREES
    ) {
      flush();
      continue;
    }
    if (runDirection !== 0 && turn.direction !== runDirection) flush();
    if (runDirection === 0) {
      runStart = index;
      runDirection = turn.direction;
    }
    runEnd = index;
    runTurns += 1;
    runTotalTurn += turn.angleDegrees;
  }
  flush();
}

/** Indices retained as display-only maneuver anchors before simplification. */
export function routeManeuverAnchorIndices(
  points: readonly Coordinates[],
  minimumVisibleDeviationMeters = 0,
): number[] {
  if (points.length <= 2) return points.map((_, index) => index);

  const safeMinimumVisibleDeviation = Number.isFinite(minimumVisibleDeviationMeters)
    ? Math.max(0, minimumVisibleDeviationMeters)
    : 0;
  const anchors = new Set<number>([0, points.length - 1]);
  for (let index = 1; index < points.length - 1; index += 1) {
    const turn = turnAt(points, index);
    if (!turn) continue;

    const isUTurn = turn.angleDegrees >= U_TURN_MIN_TURN_DEGREES;
    const isVisibleSharpTurn = turn.angleDegrees >= HIGH_CURVATURE_TURN_DEGREES
      && pointToSegmentMeters(
        points[index]!,
        points[index - 1]!,
        points[index + 1]!,
      ) > safeMinimumVisibleDeviation;
    if (isUTurn || isVisibleSharpTurn) {
      // A true reversal is protected even when zoomed far out. Ordinary sharp
      // turns are anchors only when their local deviation is visible at the
      // current tolerance, so a sub-tolerance road bump can still collapse.
      anchors.add(index);
    }
  }
  collectRoundaboutAnchors(points, anchors);
  return [...anchors].sort((left, right) => left - right);
}

function simplifyRouteSegment(
  points: readonly Coordinates[],
  toleranceMeters: number,
): Coordinates[] {
  if (points.length <= 2) return [...points];

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

/** Display-only Douglas-Peucker projection with maneuver anchor protection. */
export function simplifyRoutePointsForDisplay(
  points: readonly Coordinates[],
  toleranceMeters: number,
): Coordinates[] {
  const safeTolerance = Number.isFinite(toleranceMeters)
    ? Math.max(0, toleranceMeters)
    : 0;
  if (points.length <= 2 || safeTolerance <= 0) return [...points];

  const anchors = routeManeuverAnchorIndices(points, safeTolerance);
  const displayed: Coordinates[] = [];
  for (let anchorIndex = 1; anchorIndex < anchors.length; anchorIndex += 1) {
    const startIndex = anchors[anchorIndex - 1]!;
    const endIndex = anchors[anchorIndex]!;
    const segment = simplifyRouteSegment(
      points.slice(startIndex, endIndex + 1),
      safeTolerance,
    );
    displayed.push(...(anchorIndex === 1 ? segment : segment.slice(1)));
  }
  return displayed;
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
