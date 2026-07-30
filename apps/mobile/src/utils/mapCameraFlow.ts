/**
 * Pure camera orchestration helpers for long-press / place-add flows.
 * Call sites pass imperative map adapters; tests assert call counts/args.
 */

import type { Coordinates } from '../types';
import { PLACE_ALTITUDE, PLACE_ZOOM } from '../components/mapCameraMath';

export interface MapCameraAdapter {
  centerOn: (
    coordinates: Coordinates,
    options?: { zoom?: number; altitude?: number },
  ) => void;
  fitRoute: (coordinates: Coordinates[]) => void;
}

export function isValidMapCoordinate(c: Coordinates | null | undefined): c is Coordinates {
  return (
    c != null &&
    Number.isFinite(c.latitude) &&
    Number.isFinite(c.longitude) &&
    c.latitude >= -90 &&
    c.latitude <= 90 &&
    c.longitude >= -180 &&
    c.longitude <= 180
  );
}

/** Neighborhood zoom used by search pick and long-press pin confirm. */
export function neighborhoodCameraOptions(): { zoom: number; altitude: number } {
  return { zoom: PLACE_ZOOM, altitude: PLACE_ALTITUDE };
}

/**
 * On valid long-press: exactly one neighborhood zoom (same scale as search pick).
 * Invalid coords → no camera call.
 */
export function cameraOnLongPress(
  map: MapCameraAdapter | null | undefined,
  coordinates: Coordinates,
): boolean {
  if (!map || !isValidMapCoordinate(coordinates)) return false;
  map.centerOn(coordinates, neighborhoodCameraOptions());
  return true;
}

/**
 * After successful add: fit self + destination when self is valid; else single-point.
 * Returns which strategy ran (for tests).
 */
export function cameraAfterSuccessfulAdd(
  map: MapCameraAdapter | null | undefined,
  destination: Coordinates,
  self: Coordinates | null | undefined,
): 'fit_self_and_dest' | 'center_dest' | 'none' {
  if (!map || !isValidMapCoordinate(destination)) return 'none';
  if (isValidMapCoordinate(self)) {
    map.fitRoute([self, destination]);
    return 'fit_self_and_dest';
  }
  map.centerOn(destination, neighborhoodCameraOptions());
  return 'center_dest';
}

/** Search-pick path keeps single neighborhood center (no regression). */
export function cameraOnSearchPick(
  map: MapCameraAdapter | null | undefined,
  coordinates: Coordinates,
): boolean {
  return cameraOnLongPress(map, coordinates);
}
