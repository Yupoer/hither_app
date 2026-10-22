import type { MapJourneyBaselineInput } from '../../screens/MapScreen/MapJourneyProgressResources';

export function mapJourneyResourceInput(): MapJourneyBaselineInput {
  return {
    journeyActive: true, groupId: 'group',
    navTarget: { id: 'destination', title: 'Destination', order: 0, day: 1, coordinates: { latitude: 25.01, longitude: 121 } },
    initialJourneyRef: { current: null }, lastRouteDistanceRef: { current: undefined }, departedStartRef: { current: false },
    presentationStickyRef: { current: { key: null, progressMax: null, distanceM: null, etaSeconds: null, progress: null } },
    setInitialDistanceM: jest.fn(), setDistanceSource: jest.fn(), setProgressDepartedStart: jest.fn(),
    setJourneyStartCoords: jest.fn(), setLastRouteDistanceM: jest.fn(), setProgressMaxSticky: jest.fn(), setLastValidPresentation: jest.fn(),
    travelMode: 'walk', navigationSessionState: { session: { id: 'session' } }, state: { group: {} },
    deviceCoords: { latitude: 25, longitude: 121 }, selfRoute: { distanceMeters: 1_000 }, deviceAccuracyM: 10, selfRouteGeneration: 1,
  };
}
