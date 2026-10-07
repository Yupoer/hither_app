import {
  BACKGROUND_JOURNEY_KEY,
  backgroundLocationOptions,
  backgroundPresenceConfig,
  createBackgroundJourneyController,
  resolveBackgroundTrackingMode,
  type BackgroundJourneyConfig,
} from '../state/backgroundJourneyController';

const base: BackgroundJourneyConfig = {
  groupId: 'group-1',
  navigationSessionId: 'session-1',
  destinationId: 'destination-1',
  target: { id: 'destination-1', title: 'Stop', coordinates: { latitude: 25, longitude: 121 }, order: 0, day: 1 },
  teamNavigationActive: true,
  destination: { latitude: 25, longitude: 121 },
  arrivalRadiusMeters: 50,
  initialDistanceM: 1000,
  sequence: 1,
  travelMode: 'walk',
  sharingEnabled: true,
};

function harness(started = false) {
  const location = {
    requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
    requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
    hasStartedLocationUpdatesAsync: jest.fn(async () => started),
    startLocationUpdatesAsync: jest.fn(async () => undefined),
    stopLocationUpdatesAsync: jest.fn(async () => undefined),
  };
  let raw: string | null = null;
  const storage = {
    getItem: jest.fn(async (_key: string) => raw),
    setItem: jest.fn(async (_key: string, value: string) => { raw = value; }),
    removeItem: jest.fn(async () => { raw = null; }),
    corrupt: () => { raw = '{bad'; },
  };
  return { location, storage, controller: createBackgroundJourneyController(location, storage) };
}

describe('background journey controller state transitions', () => {
  it('normalizes presence config and resolves privacy/foreground/navigation modes', () => {
    expect(backgroundPresenceConfig({ ...base, highAccuracy: true })).toMatchObject({
      navigationSessionId: null,
      destinationId: 'group-presence',
      powerMode: 'allDay',
      highAccuracy: true,
      teamNavigationActive: false,
      completeSolo: false,
    });
    expect(resolveBackgroundTrackingMode({ ...base, sharingEnabled: false })).toBe('hidden');
    expect(resolveBackgroundTrackingMode({ ...base, appState: 'active', teamNavigationActive: false })).toBe('foreground');
    expect(resolveBackgroundTrackingMode({ ...base, appState: 'background', teamNavigationActive: true })).toBe('teamNavigation');
    expect(resolveBackgroundTrackingMode({ ...base, appState: 'background', highAccuracy: true })).toBe('navigationMax');
    expect(backgroundLocationOptions('journey', true, 'navigationMax')).toMatchObject({
      accuracy: 5, timeInterval: 5_000, deferredUpdatesDistance: 0,
    });
    expect(backgroundLocationOptions('journey', true, 'passiveBackground')).toMatchObject({
      activityType: 1, showsBackgroundLocationIndicator: false,
      accuracy: 2, timeInterval: 150_000, deferredUpdatesInterval: 150_000,
    });
  });

  it('serializes start/update/stop and rejects stale epochs without resurrecting GPS', async () => {
    const { controller, location, storage } = harness();
    await expect(controller.start(base)).resolves.toBe('started');
    expect(storage.setItem).toHaveBeenCalledWith(BACKGROUND_JOURNEY_KEY, expect.any(String));
    const stored = JSON.parse((storage.setItem.mock.calls[0] as [string, string])[1]) as BackgroundJourneyConfig;
    expect(stored.trackingEpoch).toEqual(expect.any(Number));

    const next = { ...base, sequence: 2 };
    await expect(controller.update(stored, next)).resolves.toBe(true);
    await expect(controller.update(stored, { ...next, sequence: 1 })).resolves.toBe(false);
    expect(JSON.parse((await storage.getItem(BACKGROUND_JOURNEY_KEY))!)).toMatchObject({ sequence: 2 });

    const stale = { ...stored, trackingEpoch: (stored.trackingEpoch ?? 0) - 1 };
    await expect(controller.update(stale, { ...next, sequence: 3 })).resolves.toBe(false);
    await controller.stop(stale);
    expect(location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await controller.stop(stored);
    expect(location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(await storage.getItem(BACKGROUND_JOURNEY_KEY)).toBeNull();
  });

  it('recovers invalid persisted JSON and restarts when the power profile changes', async () => {
    const { controller, location, storage } = harness(true);
    storage.corrupt();
    await expect(controller.load()).resolves.toBeNull();
    await expect(controller.start({ ...base, powerMode: 'journey', highAccuracy: false })).resolves.toBe('started');
    const prior = JSON.parse((storage.setItem.mock.calls.at(-1) as [string, string])[1]) as BackgroundJourneyConfig;
    await expect(controller.start({
      ...base,
      powerMode: 'journey',
      highAccuracy: true,
      sequence: 0,
      trackingEpoch: prior.trackingEpoch,
    })).resolves.toBe('started');
    expect(location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps background prompts ordered and refuses unprepared transitions', async () => {
    const { controller, location, storage } = harness();
    await expect(controller.start({ ...base, appState: 'background', permissionsPrepared: false })).resolves.toBe('permission_denied');
    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    await expect(controller.preparePermissions()).resolves.toBe('ready');
    expect(location.requestForegroundPermissionsAsync.mock.invocationCallOrder[0]).toBeLessThan(
      location.requestBackgroundPermissionsAsync.mock.invocationCallOrder[0],
    );
  });
});


it.each([
  { teamNavigationActive: false }, { teamNavigationActive: undefined }, { target: undefined },
  { navigationSessionId: null }, { destinationId: '' },
])('uses passive GPS for missing actual journey intent or target: %j', async invalid => {
  const { controller, location } = harness();
  await controller.start({ ...base, powerMode: 'journey', highAccuracy: true, ...invalid });
  expect(location.startLocationUpdatesAsync).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    accuracy: 2, timeInterval: 150_000, activityType: 1, showsBackgroundLocationIndicator: false,
  }));
});

it('migrates an old native passive owner even when its persisted power profile is unchanged', async () => {
  const { controller, location } = harness(true);
  const passive = backgroundPresenceConfig(base);
  await controller.start(passive);
  Object.assign(location, { hasMatchingLocationOwnerAsync: jest.fn(async () => false) });
  await controller.start(passive);
  expect(location.stopLocationUpdatesAsync).toHaveBeenCalled();
  expect(location.startLocationUpdatesAsync).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    accuracy: 2, activityType: 1, showsBackgroundLocationIndicator: false,
  }));
});


it('restores a same-owner passive mode if background navigation acquisition fails', async () => {
  const { controller, location } = harness(true);
  await controller.start({ ...base, actorId: 'actor', powerMode: 'allDay' });
  location.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('permission_changed'));
  await expect(controller.start({ ...base, actorId: 'actor', highAccuracy: true })).rejects.toThrow('permission_changed');
  expect(await controller.load()).toMatchObject({ actorId: 'actor', powerMode: 'allDay' });
  expect(location.startLocationUpdatesAsync).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
    accuracy: 2, activityType: 1, showsBackgroundLocationIndicator: false,
  }));
});

it('does not restore a previous account owner after acquisition fails for the next account', async () => {
  const { controller, location } = harness(true);
  await controller.start({ ...base, actorId: 'previous', powerMode: 'allDay' });
  location.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('permission_changed'));
  await expect(controller.start({ ...base, actorId: 'next', highAccuracy: true })).rejects.toThrow('permission_changed');
  expect(await controller.load()).toBeNull();
  expect(location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
});
