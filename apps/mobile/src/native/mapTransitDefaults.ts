import { Platform } from 'react-native';

/**
 * Provider-specific map defaults for transit orientation.
 *
 * Platform selection lives here (native boundary), not in UI components.
 * - Android Google Maps: `showsTransit` (requires Maps SDK ≥ 20 + patch).
 * - iOS MapKit: no public Transit mapType. Exclusive
 *   `MKPointOfInterestFilter` via RN-maps `pointsOfInterestFilter` so only
 *   public transport and related travel POIs render (not stock "all POIs").
 */
export const APPLE_TRANSIT_POI_FILTER = [
  'publicTransport',
  'airport',
  'parking',
  'marina',
] as const;

export type MapTransitDefaultProps = {
  showsTransit?: boolean;
  showsPointsOfInterests?: boolean;
  showsBuildings?: boolean;
  pointsOfInterestFilter?: readonly string[];
};

export function defaultMapTransitProps(): MapTransitDefaultProps {
  if (Platform.OS === 'android') {
    return { showsTransit: true };
  }
  if (Platform.OS === 'ios') {
    return {
      showsPointsOfInterests: true,
      showsBuildings: false,
      pointsOfInterestFilter: APPLE_TRANSIT_POI_FILTER,
    };
  }
  return {};
}
