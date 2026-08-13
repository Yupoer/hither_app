import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ROUTE_REORDER_TOUR_STEPS,
  clearRouteReorderTour,
  completeRouteReorderTour,
  readRouteReorderTourCompletedLocal,
  routeReorderTourAccountSyncPendingKey,
  routeReorderTourStorageKey,
  shouldStartRouteReorderTour,
} from '../featureTour/routeReorderTour';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const updateProfile = jest.fn();
jest.mock('../api/services/ProfileService', () => ({
  updateProfile: (...args: unknown[]) => updateProfile(...args),
}));

describe('route reorder tour (#189)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    updateProfile.mockResolvedValue(undefined);
  });

  it('uses the six route-editor targets in their acceptance order', () => {
    expect(ROUTE_REORDER_TOUR_STEPS.map((step) => step.id)).toEqual([
      'routeMode',
      'routeDate',
      'routeAccommodation',
      'routeTripDetails',
      'routeFavorites',
      'routeImport',
    ]);
    expect(ROUTE_REORDER_TOUR_STEPS.every((step) => step.target === step.id)).toBe(true);
  });

  it('requires leader edit access, a completed route open, and one gathering point', () => {
    const ready = {
      routeOverlayOpenComplete: true,
      isLeader: true,
      canEditItinerary: true,
      gatheringPointCount: 1,
      localCompleted: false,
      accountCompleted: false,
      targetsReady: true,
    };
    expect(shouldStartRouteReorderTour(ready)).toBe(true);
    expect(shouldStartRouteReorderTour({ ...ready, routeOverlayOpenComplete: false })).toBe(false);
    expect(shouldStartRouteReorderTour({ ...ready, isLeader: false })).toBe(false);
    expect(shouldStartRouteReorderTour({ ...ready, canEditItinerary: false })).toBe(false);
    expect(shouldStartRouteReorderTour({ ...ready, gatheringPointCount: 0 })).toBe(false);
    expect(shouldStartRouteReorderTour({ ...ready, targetsReady: false })).toBe(false);
    expect(shouldStartRouteReorderTour({ ...ready, accountCompleted: true })).toBe(false);
  });

  it('scopes local completion and pending retry by account', async () => {
    expect(routeReorderTourStorageKey('user-a')).toBe('hither.routeReorderTour.v1:user-a');
    expect(routeReorderTourStorageKey('user-a')).not.toBe(routeReorderTourStorageKey('user-b'));
    expect(routeReorderTourAccountSyncPendingKey('user-a')).not.toBe(
      routeReorderTourAccountSyncPendingKey('user-b'),
    );

    await completeRouteReorderTour({ accountId: 'user-a', existingPreferences: {} });
    expect(await readRouteReorderTourCompletedLocal('user-a')).toBe(true);
    expect(await readRouteReorderTourCompletedLocal('user-b')).toBe(false);
    expect(updateProfile).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ routeReorderTourCompleted: true }),
    });

    await clearRouteReorderTour({
      accountId: 'user-a',
      existingPreferences: { routeReorderTourCompleted: true },
    });
    expect(await readRouteReorderTourCompletedLocal('user-a')).toBe(false);
    expect(updateProfile).toHaveBeenLastCalledWith({
      preferences: expect.objectContaining({ routeReorderTourCompleted: false }),
    });
  });

  it('wires the tour to route-sheet completion and target refs without invoking route actions', () => {
    const mapScreen = readFileSync(
      join(__dirname, '../screens/MapScreen.tsx'),
      'utf8',
    );
    const list = readFileSync(
      join(__dirname, '../components/DestinationReorderList.tsx'),
      'utf8',
    );
    expect(mapScreen).toContain('onOpenComplete={() => {');
    expect(mapScreen).toContain('setRouteOverlayOpenComplete(true)');
    expect(mapScreen).toContain('onTourTargetRef={setTourTargetRef}');
    expect(mapScreen).toContain("setTourTargetRef('routeMode'");
    expect(list).toContain("onTourTargetRef?.('routeFavorites'");
    expect(list).toContain("onTourTargetRef?.('routeImport'");
    expect(mapScreen).toContain('routeTourActive');
    expect(mapScreen).not.toContain('onRouteTourNext();');
  });
});
