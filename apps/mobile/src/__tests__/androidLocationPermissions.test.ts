import {
  BACKGROUND_JOURNEY_KEY,
  createBackgroundJourneyController,
  backgroundLocationOptions,
  type BackgroundJourneyConfig,
} from '../state/backgroundJourneyController';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const config: BackgroundJourneyConfig = {
  groupId: 'group-1',
  navigationSessionId: null,
  destinationId: 'destination-1',
  destination: { latitude: 25.0478, longitude: 121.517 },
  arrivalRadiusMeters: 50,
  initialDistanceM: 1000,
  sequence: 0,
  travelMode: 'walk',
  sharingEnabled: true,
};

function harness(started = false) {
  const location = {
    requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(started),
    startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
    stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  };
  const storage = {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  };
  return {
    location,
    storage,
    controller: createBackgroundJourneyController(location, storage),
  };
}

describe('Android location permission progression', () => {
  it('requests foreground before background and does not start service when denied', async () => {
    const { controller, location, storage } = harness();
    location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    location.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(controller.start(config)).resolves.toBe('permission_denied');
    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalled();
    expect(location.requestBackgroundPermissionsAsync).toHaveBeenCalled();
    expect(location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('does not request background when foreground is denied', async () => {
    const { controller, location } = harness();
    location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(controller.start(config)).resolves.toBe('permission_denied');
    expect(location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('starts updates only after both permissions are granted', async () => {
    const { controller, location, storage } = harness();
    await expect(controller.start(config)).resolves.toBe('started');
    expect(location.requestForegroundPermissionsAsync.mock.invocationCallOrder[0]).toBeLessThan(
      location.requestBackgroundPermissionsAsync.mock.invocationCallOrder[0],
    );
    expect(location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(
      BACKGROUND_JOURNEY_KEY,
      expect.any(String),
    );
  });

  it('exposes foreground service notification copy for all-day and journey', () => {
    const journey = backgroundLocationOptions('journey', false) as {
      foregroundService: { notificationTitle: string; notificationBody: string };
    };
    const allDay = backgroundLocationOptions('allDay', false) as {
      foregroundService: { notificationTitle: string; notificationBody: string };
    };
    expect(journey.foregroundService.notificationTitle).toContain('導航');
    expect(allDay.foregroundService.notificationTitle).toContain('定位');
  });

  it('keeps accuracy-aware arrival (does not lower radius for approximate-only)', () => {
    const arrival = readFileSync(
      join(__dirname, '../utils/navigationArrival.ts'),
      'utf8',
    );
    // Arrival confirmation must consider horizontal accuracy — never shrink radius.
    expect(arrival).toMatch(/accuracy|accuracyM|horizontalAccuracy/i);
    expect(arrival).not.toMatch(/approximateOnly[\s\S]{0,80}radius\s*[-=]/);
  });

  it('location boundary exposes permission state without blocking the app', () => {
    const locationSrc = readFileSync(join(__dirname, '../native/location.ts'), 'utf8');
    expect(locationSrc).toContain('getPermissionState');
    expect(locationSrc).toContain('requestForegroundPermissionsAsync');
    expect(locationSrc).toContain('getBackgroundPermissionsAsync');
  });
});
