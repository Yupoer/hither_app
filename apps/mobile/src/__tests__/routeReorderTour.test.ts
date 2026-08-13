import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import {
  ROUTE_REORDER_TOUR_STEPS,
  clearRouteReorderTour,
  completeRouteReorderTour,
  parseRouteReorderTourAccountSyncPending,
  readRouteReorderTourCompletedLocal,
  readRouteReorderTourAccountSyncPending,
  routeTourScrollOffset,
  routeReorderTourAccountSyncPendingKey,
  routeReorderTourStorageKey,
  retryPendingRouteReorderTourAccountSync,
  shouldStartRouteReorderTour,
  useRouteReorderTour,
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

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => { unmount: () => void };
};

function flushRouteTour(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

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

  it('scrolls long route targets into a small, large-text viewport', () => {
    expect(routeTourScrollOffset({
      currentOffset: 120,
      targetPageY: 760,
      targetHeight: 64,
      containerPageY: 80,
      viewportHeight: 320,
    })).toBe(560);
    expect(routeTourScrollOffset({
      currentOffset: 520,
      targetPageY: 200,
      targetHeight: 420,
      containerPageY: 80,
      viewportHeight: 320,
    })).toBe(624);
    expect(routeTourScrollOffset({
      currentOffset: 520,
      targetPageY: 180,
      targetHeight: 80,
      containerPageY: 80,
      viewportHeight: 320,
    })).toBe(520);
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

  it('parses only account-scoped pending sync markers', async () => {
    expect(parseRouteReorderTourAccountSyncPending(null)).toBeNull();
    expect(parseRouteReorderTourAccountSyncPending('not-json')).toBeNull();
    expect(parseRouteReorderTourAccountSyncPending('{"accountId":"","completed":true}')).toBeNull();
    expect(parseRouteReorderTourAccountSyncPending('{"accountId":"user-a","completed":true}'))
      .toEqual({ accountId: 'user-a', completed: true });

    await AsyncStorage.setItem(
      routeReorderTourAccountSyncPendingKey('user-a'),
      JSON.stringify({ accountId: 'user-a', completed: false }),
    );
    await expect(readRouteReorderTourAccountSyncPending('user-a')).resolves.toEqual({
      accountId: 'user-a',
      completed: false,
    });
    await expect(readRouteReorderTourAccountSyncPending('user-b')).resolves.toBeNull();
    await expect(readRouteReorderTourAccountSyncPending(null)).resolves.toBeNull();
  });

  it('retries a pending account write and keeps it when the retry fails', async () => {
    await AsyncStorage.setItem(
      routeReorderTourAccountSyncPendingKey('user-a'),
      JSON.stringify({ accountId: 'user-a', completed: true }),
    );
    updateProfile.mockRejectedValueOnce(new Error('offline'));
    await expect(
      retryPendingRouteReorderTourAccountSync({ accountId: 'user-a' }),
    ).resolves.toBe(false);
    expect(await readRouteReorderTourAccountSyncPending('user-a')).toEqual({
      accountId: 'user-a',
      completed: true,
    });

    updateProfile.mockResolvedValueOnce(undefined);
    await expect(
      retryPendingRouteReorderTourAccountSync({
        accountId: 'user-a',
        existingPreferences: { routeReorderTourCompleted: false },
      }),
    ).resolves.toBe(true);
    expect(await readRouteReorderTourAccountSyncPending('user-a')).toBeNull();
  });

  it('retains completion or reset intent locally when account sync fails', async () => {
    updateProfile.mockRejectedValueOnce(new Error('offline'));
    await completeRouteReorderTour({ accountId: 'user-a' });
    expect(await readRouteReorderTourCompletedLocal('user-a')).toBe(true);
    expect(await readRouteReorderTourAccountSyncPending('user-a')).toEqual({
      accountId: 'user-a',
      completed: true,
    });

    updateProfile.mockRejectedValueOnce(new Error('offline'));
    await clearRouteReorderTour({ accountId: 'user-a' });
    expect(await readRouteReorderTourCompletedLocal('user-a')).toBe(false);
    expect(await readRouteReorderTourAccountSyncPending('user-a')).toEqual({
      accountId: 'user-a',
      completed: false,
    });
  });

  it('measures all six targets atomically and completes only after the last step', async () => {
    const measureTarget = jest.fn(async () => ({ x: 8, y: 12, width: 120, height: 36 }));
    const scrollToTarget = jest.fn();
    let latest: ReturnType<typeof useRouteReorderTour> | undefined;
    function Probe() {
      latest = useRouteReorderTour({
        routeOverlayOpenComplete: true,
        isLeader: true,
        canEditItinerary: true,
        gatheringPointCount: 1,
        accountId: 'user-a',
        accountPreferences: { routeReorderTourCompleted: false },
        measureTarget,
        scrollToTarget,
      });
      return null;
    }

    const root = create(React.createElement(Probe));
    for (let i = 0; i < 5 && !latest?.tourActive; i += 1) await flushRouteTour();
    expect(latest?.tourActive).toBe(true);
    expect(latest?.step?.id).toBe('routeMode');
    expect(latest?.targetRect).toEqual({ x: 8, y: 12, width: 120, height: 36 });
    expect(measureTarget).toHaveBeenCalledTimes(6);

    await act(async () => latest?.onNext());
    await flushRouteTour();
    expect(latest?.step?.id).toBe('routeDate');
    expect(scrollToTarget).toHaveBeenCalledWith('routeDate');

    await act(async () => latest?.onPrev());
    await flushRouteTour();
    expect(latest?.step?.id).toBe('routeMode');

    for (let i = 0; i < ROUTE_REORDER_TOUR_STEPS.length; i += 1) {
      await act(async () => latest?.onNext());
      await flushRouteTour();
    }
    expect(latest?.tourActive).toBe(false);
    expect(updateProfile).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ routeReorderTourCompleted: true }),
    });
    root.unmount();
  });

  it('waits for an async accommodation scroll before measuring its post-scroll rect', async () => {
    let scrollResolved = false;
    let releaseScroll = () => {};
    const scrollPromise = new Promise<void>((resolve) => {
      releaseScroll = () => {
        scrollResolved = true;
        resolve();
      };
    });
    const measureTarget = jest.fn(async (id) => ({
      x: 8,
      y: id === 'routeAccommodation' && scrollResolved ? 740 : 12,
      width: 120,
      height: 36,
    }));
    const scrollToTarget = jest.fn((id: string) => (
      id === 'routeAccommodation' ? scrollPromise : Promise.resolve()
    ));
    let latest: ReturnType<typeof useRouteReorderTour> | undefined;
    function Probe() {
      latest = useRouteReorderTour({
        routeOverlayOpenComplete: true,
        isLeader: true,
        canEditItinerary: true,
        gatheringPointCount: 1,
        accountId: 'user-a',
        accountPreferences: { routeReorderTourCompleted: false },
        measureTarget,
        scrollToTarget,
      });
      return null;
    }

    const root = create(React.createElement(Probe));
    for (let i = 0; i < 5 && !latest?.tourActive; i += 1) await flushRouteTour();
    await act(async () => latest?.onNext());
    const callsBeforeAccommodation = measureTarget.mock.calls.length;
    let transition: void | Promise<void>;
    await act(async () => {
      transition = latest?.onNext();
      await Promise.resolve();
    });
    expect(scrollToTarget).toHaveBeenCalledWith('routeAccommodation');
    expect(measureTarget).toHaveBeenCalledTimes(callsBeforeAccommodation);

    releaseScroll();
    await act(async () => {
      await transition;
    });
    expect(measureTarget).toHaveBeenLastCalledWith('routeAccommodation');
    expect(latest?.targetRect?.y).toBe(740);
    root.unmount();
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
    expect(mapScreen).toContain("target === 'routeAccommodation'");
    expect(mapScreen).toContain('measureInWindow');
    expect(mapScreen).toContain('routeTourScrollOffset');
    expect(list).toContain("onTourTargetRef?.('routeAccommodation'");
    expect(list).toContain("onTourTargetRef?.('routeFavorites'");
    expect(list).toContain("onTourTargetRef?.('routeImport'");
    expect(mapScreen).toContain('routeTourActive');
    expect(mapScreen).not.toContain('onRouteTourNext();');
  });
});
