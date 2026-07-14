import {
  BACKGROUND_JOURNEY_KEY,
  createBackgroundJourneyController,
  type BackgroundJourneyConfig,
} from '../state/backgroundJourneyController';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const config: BackgroundJourneyConfig = {
  groupId: 'group-1',
  destinationId: 'destination-1',
  destination: { latitude: 25.0478, longitude: 121.517 },
  initialDistanceM: 1000,
  travelMode: 'walk',
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

describe('background journey controller', () => {
  it('persists the active journey and starts native updates', async () => {
    const { controller, location, storage } = harness();

    await expect(controller.start(config)).resolves.toBe('started');

    expect(storage.setItem).toHaveBeenCalledWith(
      BACKGROUND_JOURNEY_KEY,
      JSON.stringify(config),
    );
    expect(location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    const opts = location.startLocationUpdatesAsync.mock.calls[0][1] as {
      accuracy: number;
      pausesUpdatesAutomatically: boolean;
    };
    // Default (highAccuracy unset) uses Balanced + OS pause when stationary.
    expect(opts.accuracy).toBe(3);
    expect(opts.pausesUpdatesAutomatically).toBe(true);
  });

  it('uses High accuracy options when highAccuracy is enabled on journey', async () => {
    const { controller, location } = harness();

    await expect(
      controller.start({ ...config, highAccuracy: true, powerMode: 'journey' }),
    ).resolves.toBe('started');

    const opts = location.startLocationUpdatesAsync.mock.calls[0][1] as {
      accuracy: number;
      distanceInterval: number;
    };
    expect(opts.accuracy).toBe(4);
    expect(opts.distanceInterval).toBe(20);
  });

  it('allDay uses Low accuracy and ignores highAccuracy for the 8h budget', async () => {
    const { controller, location } = harness();

    await expect(
      controller.start({
        ...config,
        highAccuracy: true,
        powerMode: 'allDay',
      }),
    ).resolves.toBe('started');

    const opts = location.startLocationUpdatesAsync.mock.calls[0][1] as {
      accuracy: number;
      deferredUpdatesInterval: number;
      pausesUpdatesAutomatically: boolean;
    };
    expect(opts.accuracy).toBe(2);
    expect(opts.deferredUpdatesInterval).toBe(180_000);
    expect(opts.pausesUpdatesAutomatically).toBe(true);
  });

  it('restarts native updates when highAccuracy profile changes', async () => {
    const { controller, location, storage } = harness(true);
    storage.getItem.mockResolvedValue(
      JSON.stringify({ ...config, highAccuracy: false, powerMode: 'journey' }),
    );

    await expect(
      controller.start({ ...config, highAccuracy: true, powerMode: 'journey' }),
    ).resolves.toBe('started');

    expect(location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  it('updates persisted config without starting a duplicate native task', async () => {
    const { controller, location, storage } = harness(true);

    await expect(controller.start(config)).resolves.toBe('started');

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('does not persist or start when background permission is denied', async () => {
    const { controller, location, storage } = harness();
    location.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(controller.start(config)).resolves.toBe('permission_denied');

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('stops idempotently and always clears persisted state', async () => {
    const active = harness(true);
    await active.controller.stop();
    expect(active.location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(active.storage.removeItem).toHaveBeenCalledWith(BACKGROUND_JOURNEY_KEY);

    const inactive = harness(false);
    await inactive.controller.stop();
    expect(inactive.location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(inactive.storage.removeItem).toHaveBeenCalledWith(BACKGROUND_JOURNEY_KEY);
  });
});

describe('background journey native wiring', () => {
  const appConfig = JSON.parse(
    readFileSync(join(__dirname, '../../app.json'), 'utf8'),
  ) as {
    expo: {
      ios: { infoPlist: Record<string, unknown> };
      plugins: unknown[];
    };
  };
  const entry = readFileSync(join(__dirname, '../../index.ts'), 'utf8');
  const taskModule = readFileSync(
    join(__dirname, '../state/backgroundJourney.ts'),
    'utf8',
  );

  it('declares iOS location and remote-notification background modes', () => {
    expect(appConfig.expo.ios.infoPlist.UIBackgroundModes).toEqual([
      'location',
      'remote-notification',
    ]);
    expect(
      appConfig.expo.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription,
    ).toEqual(expect.any(String));
  });

  it('defines the task at module scope before the app is registered', () => {
    expect(taskModule).toContain('TaskManager.defineTask');
    expect(taskModule).toContain('updateMyLocation');
    expect(entry.indexOf("import './src/state/backgroundJourney';")).toBeLessThan(
      entry.indexOf("import App from './App';"),
    );
  });

  it('starts from MapScreen and stops on pause, leave, or sign-out', () => {
    const mapScreen = readFileSync(
      join(__dirname, '../screens/MapScreen.tsx'),
      'utf8',
    );
    const session = readFileSync(
      join(__dirname, '../state/SessionContext.tsx'),
      'utf8',
    );

    expect(mapScreen).toContain('startBackgroundJourney');
    expect(mapScreen).toContain('initialJourneyDistance');
    expect(mapScreen).toContain('stopBackgroundJourney');
    expect(session).toContain('signOutWithJourneyCleanup');
    expect(session).toContain('leaveGroupWithJourneyCleanup');
  });
});
