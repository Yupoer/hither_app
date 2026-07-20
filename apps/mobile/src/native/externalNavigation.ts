import { Linking, Platform } from 'react-native';
import type { Destination } from '../types';
import type { TravelMode } from './maps';

/** Map travel mode to Google Maps `travelmode` query values. */
function googleTravelMode(mode: TravelMode): string {
  switch (mode) {
    case 'drive':
      return 'driving';
    case 'transit':
      return 'transit';
    case 'walk':
    default:
      return 'walking';
  }
}

/** Map travel mode to Apple Maps `dirflg` values. */
function appleDirFlag(mode: TravelMode): string {
  switch (mode) {
    case 'drive':
      return 'd';
    case 'transit':
      return 'r';
    case 'walk':
    default:
      return 'w';
  }
}

/**
 * Single navigation-URL boundary for external turn-by-turn.
 * Android → Google Maps universal URL (no API key).
 * iOS → Apple Maps.
 */
export function buildNavigationUrl(
  platform: 'ios' | 'android',
  destination: Destination,
  travelMode: TravelMode,
): string {
  const { latitude, longitude } = destination.coordinates;
  if (platform === 'android') {
    const params = new URLSearchParams({
      api: '1',
      destination: `${latitude},${longitude}`,
      travelmode: googleTravelMode(travelMode),
    });
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  const params = new URLSearchParams({
    daddr: `${latitude},${longitude}`,
    dirflg: appleDirFlag(travelMode),
  });
  // Optional label when title is present — still fully encoded by URLSearchParams.
  if (destination.title.trim()) {
    params.set('q', destination.title.trim());
  }
  return `https://maps.apple.com/?${params.toString()}`;
}

/**
 * Open the platform maps app (or browser fallback). Missing Google Maps app
 * on Android falling through to the browser is not an error.
 */
export async function openExternalNavigation(
  destination: Destination,
  travelMode: TravelMode,
): Promise<void> {
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  const url = buildNavigationUrl(platform, destination, travelMode);
  await Linking.openURL(url);
}
