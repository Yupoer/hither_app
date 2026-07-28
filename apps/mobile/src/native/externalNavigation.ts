import { Alert, Linking } from 'react-native';
import type { Destination } from '../types';
import type { TravelMode } from './maps';

/** Explicit maps app choice (not Platform default). */
export type ExternalMapsProvider = 'google' | 'apple';

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
 * Build an external navigation URL for the chosen maps provider.
 * Provider is explicit — callers must not assume Platform.OS mapping.
 */
export function buildNavigationUrl(
  provider: ExternalMapsProvider,
  destination: Destination,
  travelMode: TravelMode,
): string {
  const { latitude, longitude } = destination.coordinates;
  if (provider === 'google') {
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
 * Open the chosen maps app (or browser fallback). Missing Google Maps app
 * falling through to the browser is not an error.
 */
export async function openExternalNavigation(
  destination: Destination,
  travelMode: TravelMode,
  provider: ExternalMapsProvider,
): Promise<void> {
  const url = buildNavigationUrl(provider, destination, travelMode);
  await Linking.openURL(url);
}

export interface ExternalMapsChooserLabels {
  title: string;
  googleLabel: string;
  appleLabel: string;
  cancelLabel: string;
  /** Shown when the selected maps app / URL cannot open. */
  openFailedTitle?: string;
  openFailedMessage?: string;
}

/**
 * Present Google Maps / Apple Maps / cancel, then open the selected provider.
 * Cancel leaves the app unchanged. Open failures surface a simple alert (spec).
 * Pure-ish seam for Jest (injectable alert/open).
 */
export function presentExternalMapsChooser(
  destination: Destination,
  travelMode: TravelMode,
  labels: ExternalMapsChooserLabels,
  deps?: {
    alert?: typeof Alert.alert;
    open?: typeof openExternalNavigation;
  },
): void {
  const alertFn = deps?.alert ?? Alert.alert;
  const openFn = deps?.open ?? openExternalNavigation;
  const failTitle = labels.openFailedTitle ?? labels.title;
  const failMessage = labels.openFailedMessage;

  const openProvider = (provider: ExternalMapsProvider) => {
    void openFn(destination, travelMode, provider).catch(() => {
      if (failMessage) {
        alertFn(failTitle, failMessage);
      }
    });
  };

  alertFn(labels.title, undefined, [
    {
      text: labels.googleLabel,
      onPress: () => openProvider('google'),
    },
    {
      text: labels.appleLabel,
      onPress: () => openProvider('apple'),
    },
    { text: labels.cancelLabel, style: 'cancel' },
  ]);
}
