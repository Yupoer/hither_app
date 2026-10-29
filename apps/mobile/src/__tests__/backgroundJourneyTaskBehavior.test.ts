jest.mock('../state/journeyNotifications', () => ({ notifyJourneyApproach: jest.fn(async () => undefined) }));
const mockAppState = { currentState: 'background' };
jest.mock('react-native', () => ({ AppState: mockAppState }));
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }));
jest.mock('../api/services/LiveActivityService', () => ({ updateLiveActivityProgress: jest.fn(async () => undefined) }));
const mockStore = new Map<string, string>();
const mockAsyncStorage = {
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
};
const mockLocation = {
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
};
const mockTaskManager = {
  isTaskDefined: jest.fn(() => false),
  defineTask: jest.fn(),
};
const mockLiveActivity = { updateAllGroupActivities: jest.fn(async () => undefined) };
const mockDiagnostics = {
  write: jest.fn(async () => undefined),
};
const mockEnqueue = jest.fn(async (..._args: unknown[]) => undefined);
const mockFlush = jest.fn(async (..._args: unknown[]) => ({ retryScheduled: 0, discarded: 0, remaining: 0 }));
const mockPurge = jest.fn(async (..._args: unknown[]) => undefined);
const mockAckNavigation = jest.fn(async (..._args: unknown[]) => undefined);
const mockClearLiveActivities = jest.fn(async (..._args: unknown[]) => undefined);
const mockArrivalRows = jest.fn(async (): Promise<unknown[]> => []);
let mockTaskCallback: ((payload: unknown) => Promise<void>) | undefined;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: mockAsyncStorage,
}));
jest.mock('expo-location', () => mockLocation);
jest.mock('expo-task-manager', () => ({
  ...mockTaskManager,
  defineTask: jest.fn((_name: string, handler: (payload: unknown) => Promise<void>) => {
    mockTaskCallback = handler;
  }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'background-event-1') }));
jest.mock('../api/services/NavigationService', () => ({
  getNavigationSessionById: jest.fn(async () => null),
  ackNavigationSession: (...args: unknown[]) => mockAckNavigation(...args),
}));
jest.mock('../native', () => ({ liveActivity: mockLiveActivity }));
jest.mock('../state/diagnostics', () => ({ diagnostics: mockDiagnostics }));
jest.mock('../state/useLiveActivity', () => ({
  clearLiveActivities: (...args: unknown[]) => mockClearLiveActivities(...args),
}));
jest.mock('../state/locationOutbox', () => ({
  enqueueLocationOutbox: (...args: unknown[]) => mockEnqueue(...args),
  flushLocationOutbox: (...args: unknown[]) => mockFlush(...args),
  purgeLocationOutbox: (...args: unknown[]) => mockPurge(...args),
}));

const {
  loadBackgroundJourney,
  prepareBackgroundJourneyPermissions,
  startBackgroundJourney,
  stopBackgroundJourney,
} = require('../state/backgroundJourney') as typeof import('../state/backgroundJourney');
const { BACKGROUND_JOURNEY_KEY } = require('../state/backgroundJourneyController') as
  typeof import('../state/backgroundJourneyController');

const baseConfig = {
  groupId: 'group-1',
  navigationSessionId: 'session-1',
  destinationId: 'stop-1',
  destination: { latitude: 25, longitude: 121 },
  arrivalRadiusMeters: 50,
  initialDistanceM: 1000,
  actorId: 'self',
  target: { id: 'stop-1', title: 'Stop', coordinates: { latitude: 25, longitude: 121 }, order: 0, day: 1 },
  sequence: 0,
  travelMode: 'walk' as const,
  sharingEnabled: true,
  powerMode: 'journey' as const,
  teamNavigationActive: true,
};
const locationSample = {
  timestamp: Date.now(),
  coords: {
    latitude: 25,
    longitude: 121,
    accuracy: 8,
    speed: 1,
    heading: 90,
  },
};

describe('background journey native task wiring', () => {
  beforeEach(() => {
    mockStore.clear();
    require('../state/locationPrivacy').setLocationAccessContext('group-1', true, true);
    mockAppState.currentState = 'background';
    jest.clearAllMocks();
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLocation.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockFlush.mockResolvedValue({ retryScheduled: 0, discarded: 0, remaining: 0 });
    mockArrivalRows.mockResolvedValue([]);
    mockTaskCallback = mockTaskCallback ?? undefined;
  });

  it('exposes prepare/start/load/stop through the singleton controller', async () => {
    mockLocation.hasStartedLocationUpdatesAsync
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mockAppState.currentState = 'active';
    await expect(prepareBackgroundJourneyPermissions()).resolves.toBe('ready');
    mockAppState.currentState = 'background';
    await expect(startBackgroundJourney({ ...baseConfig, permissionsPrepared: true })).resolves.toBe('started');
    await expect(loadBackgroundJourney()).resolves.toEqual(expect.objectContaining(baseConfig));
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await expect(stopBackgroundJourney()).resolves.toBeUndefined();
    expect(mockLocation.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    // Preparation reads permissions once; the legacy adapter verifies Always again before acquisition.
    expect(mockLocation.getBackgroundPermissionsAsync).toHaveBeenCalledTimes(2);
    expect(mockLocation.stopLocationUpdatesAsync).toHaveBeenCalledWith(
      'hither-background-journey-location',
    );
  });

  it('handles error/no-op, hidden sharing, upload, arrival ACK, and timeline paths', async () => {
    if (!mockTaskCallback) throw new Error('background journey task was not registered');
    const task = mockTaskCallback;

    await task({ data: undefined, error: new Error('native failure') });
    await task({ data: { locations: [] }, error: null });
    expect(mockDiagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'location_callback',
      success: false,
    }));

    await startBackgroundJourney({ ...baseConfig, navigationSessionId: null, sharingEnabled: false, permissionsPrepared: true });
    // A hidden sharing profile intentionally has no persisted tracking task.
    await expect(startBackgroundJourney({ ...baseConfig, navigationSessionId: null, sharingEnabled: false, permissionsPrepared: true })).resolves.toBe('hidden');
    await expect(loadBackgroundJourney()).resolves.toBeNull();
    await startBackgroundJourney({ ...baseConfig, permissionsPrepared: true });
    const loaded = await loadBackgroundJourney();
    await mockAsyncStorage.setItem(BACKGROUND_JOURNEY_KEY, JSON.stringify({ ...loaded, sharingEnabled: false }));
    expect(mockStore.get(BACKGROUND_JOURNEY_KEY)).toEqual(expect.any(String));
    await expect(mockAsyncStorage.getItem(BACKGROUND_JOURNEY_KEY)).resolves.toEqual(expect.any(String));
    await expect(loadBackgroundJourney()).resolves.toEqual(expect.objectContaining({
      sharingEnabled: false,
    }));
    expect(mockAsyncStorage.getItem).toHaveBeenCalledWith(BACKGROUND_JOURNEY_KEY);
    await task({ data: { locations: [locationSample] }, error: null });
    expect(mockPurge).toHaveBeenCalled();
    expect(mockLiveActivity.updateAllGroupActivities).not.toHaveBeenCalled();

    await startBackgroundJourney({ ...baseConfig, permissionsPrepared: true });
    await task({ data: { locations: [locationSample] }, error: null });
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'group-1',
      source: 'background_task',
      trackingMode: expect.any(String),
    }));
    expect(mockFlush).toHaveBeenCalled();
    expect(mockAckNavigation).not.toHaveBeenCalledWith('session-1', 'arrived', expect.anything());
    expect(require('../state/arrivalSync').enqueueAutomaticArrival).toHaveBeenCalled();
    expect(mockClearLiveActivities).not.toHaveBeenCalled();
    expect(mockDiagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'background_op_timeline',
    }));
  });

  it('does not process background GPS callbacks while inactive system UI covers the map', async () => {
    await stopBackgroundJourney();
    await startBackgroundJourney({ ...baseConfig, permissionsPrepared: true });
    jest.clearAllMocks();
    mockAppState.currentState = 'inactive';
    await mockTaskCallback!({ data: { locations: [{ ...locationSample, timestamp: Date.now() }] } });
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockAckNavigation).not.toHaveBeenCalled();
    expect(mockLiveActivity.updateAllGroupActivities).not.toHaveBeenCalled();
    expect(require('../state/arrivalSync').enqueueAutomaticArrival).not.toHaveBeenCalled();
  });

  it('keeps a terminal personal receipt local without duplicating it and fences the next account', async () => {
    await stopBackgroundJourney();
    mockArrivalRows.mockResolvedValue([{
      id: 'receipt', actorId: 'self', sequence: 1, createdAt: 1,
      operationType: 'record_arrival', entityId: 'stop-1', status: 'conflict',
      payload: { actorId: 'self', userId: 'self', navigationSessionId: 'session-1',
        arrivedAt: new Date().toISOString() },
    }]);
    await startBackgroundJourney({ ...baseConfig, permissionsPrepared: true });
    await mockTaskCallback!({ data: { locations: [{ ...locationSample, timestamp: Date.now() }] } });
    expect(require('../state/arrivalSync').enqueueAutomaticArrival).not.toHaveBeenCalled();
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: 1, destinationId: 'stop-1', personalArrived: true,
      personalArrivalAtMs: 1, personalArrivalSequence: 1,
    }));
    await stopBackgroundJourney();
    jest.clearAllMocks();
    await startBackgroundJourney({ ...baseConfig, actorId: 'another-user', permissionsPrepared: true });
    await mockTaskCallback!({ data: { locations: [{ ...locationSample, timestamp: Date.now() + 1 }] } });
    expect(require('../state/arrivalSync').enqueueAutomaticArrival).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'another-user' }));
  });

  it('does not reuse an acknowledged arrival belonging to an earlier navigation session', async () => {
    await stopBackgroundJourney();
    mockArrivalRows.mockResolvedValue([{
      operationType: 'record_arrival', entityId: 'stop-1', status: 'acked',
      payload: { actorId: 'self', userId: 'self', navigationSessionId: 'old-session' },
    }]);
    await startBackgroundJourney({ ...baseConfig, navigationSessionId: 'new-session', permissionsPrepared: true });
    await mockTaskCallback!({ data: { locations: [{ ...locationSample, timestamp: Date.now() }] }, error: null });
    expect(require('../state/arrivalSync').enqueueAutomaticArrival).toHaveBeenCalledWith(expect.objectContaining({
      navigationSessionId: 'new-session', actorId: 'self',
    }));
  });
});

it('background route progress matches foreground; duplicate samples do not reprocess arrival', async () => {
  await stopBackgroundJourney();
  const task = mockTaskCallback!;
  const start = { latitude: 25.005, longitude: 121 };
  const config = { ...baseConfig, initialDistanceM: 740, distanceSource: 'route' as const,
    routeAnchorGps: start, routeAnchorRemainingM: 740, startCoords: start,
    accentHex: '#F5B142', etaSeconds: 780 };
  await startBackgroundJourney({ ...config, permissionsPrepared: true });
  await task({ data: { locations: [{ ...locationSample, coords: { ...locationSample.coords, ...start } }] } });
  expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenLastCalledWith(expect.objectContaining({
    progress: 0, distanceMeters: 740, etaSeconds: 780 * 690 / 740, accentHex: '#F5B142',
  }));
  const { derivePersonalProgress } = require('../utils/personalProgress');
  const walking = { ...start, latitude: start.latitude - 0.0005 };
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_001);
  await task({ data: { locations: [{ ...locationSample, timestamp: locationSample.timestamp + 1, coords: { ...locationSample.coords, ...walking } }] } });
  clock.mockRestore();
  const foreground = derivePersonalProgress({ ...config, deviceCoords: walking, targetCoords: config.destination,
    routeAnchorGps: start, routeAnchorRemainingM: 740, routeEtaSeconds: 780 });
  expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenLastCalledWith(expect.objectContaining({
    progress: foreground.progress, distanceMeters: foreground.distanceMeters,
  }));
  await startBackgroundJourney({ ...baseConfig, permissionsPrepared: true });
  await task({ data: { locations: [locationSample] } });
  const count = mockLiveActivity.updateAllGroupActivities.mock.calls.length;
  expect((await loadBackgroundJourney())?.navigationSessionId).toBe('session-1');
  await task({ data: { locations: [locationSample] } });
  expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenCalledTimes(count);
  expect((await loadBackgroundJourney())?.navigationSessionId).toBe('session-1');
});
jest.mock('../state/arrivalSync', () => ({
  ...jest.requireActual('../state/arrivalSync'),
  enqueueAutomaticArrival: jest.fn(async input => ({ status: 'pending', createdAt: input.sampledAtMs,
    payload: { ...input, actorId: input.actorId, userId: input.actorId, source: 'automatic',
      occurredAt: new Date(input.sampledAtMs).toISOString(), arrivedAt: new Date(input.sampledAtMs).toISOString() },
  })),
}));
jest.mock('../api/services/GatheringWorkflowService', () => ({ fetchDestinationArrivals: jest.fn(async () => []) }));
jest.mock('../state/coreDataSync', () => ({ readLocalJourneyProjection: jest.fn(async () => null), getCoreOperationOutbox: () => ({ listByGroup: () => mockArrivalRows() }), flushCoreOperationOutbox: jest.fn(async () => undefined) }));


it('stops background acquisition while access hydrates and purges only after confirmed revocation', async () => {
  const { setLocationAccessContext, setLocationSharingConsent, captureLocationAccess } = require('../state/locationPrivacy');
  setLocationAccessContext('group-1', true, true);
  const previousAccess = await captureLocationAccess('group-1');
  mockPurge.mockClear();
  setLocationAccessContext(undefined, true);
  expect(previousAccess.signal.aborted).toBe(true);
  expect(await captureLocationAccess()).toBeNull();
  expect(mockPurge).not.toHaveBeenCalled();
  setLocationAccessContext('group-1', true, true);
  expect(await captureLocationAccess('group-1')).not.toBeNull();
  setLocationAccessContext(null, false);
  await Promise.resolve();
  expect(mockPurge).toHaveBeenCalledTimes(1);
  setLocationAccessContext(undefined, false);
  setLocationSharingConsent(false);
  expect(mockPurge).toHaveBeenCalledTimes(2);
});

it.each([
  { state: 'pending', context: undefined, sharingEnabled: true, hasMembership: true, purges: 0 },
  { state: 'revoked', context: null, sharingEnabled: true, hasMembership: true, purges: 1 },
  { state: 'sharing disabled', context: undefined, sharingEnabled: false, hasMembership: true, purges: 1 },
  { state: 'membership removed', context: undefined, sharingEnabled: true, hasMembership: false, purges: 1 },
])('handles a registered cold-launch GPS callback with $state access', async ({ context, sharingEnabled, hasMembership, purges }) => {
  mockStore.clear();
  mockAppState.currentState = 'background';
  jest.clearAllMocks();
  mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
  jest.isolateModules(() => {
    const privacy = require('../state/locationPrivacy') as typeof import('../state/locationPrivacy');
    privacy.setLocationAccessContext(context, true);
    require('../state/backgroundJourney');
  });
  mockStore.set(BACKGROUND_JOURNEY_KEY, JSON.stringify({ ...baseConfig, sharingEnabled, hasMembership }));

  if (!mockTaskCallback) throw new Error('background journey task was not registered');
  await mockTaskCallback({ data: { locations: [locationSample] }, error: null });

  expect(mockLocation.stopLocationUpdatesAsync).toHaveBeenCalledWith('hither-background-journey-location');
  expect(mockLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
  expect(mockLocation.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(mockEnqueue).not.toHaveBeenCalled();
  expect(mockFlush).not.toHaveBeenCalled();
  expect(mockPurge).toHaveBeenCalledTimes(purges);
});

it('cancels a new background start on unavailable preference storage without tearing down the established owner', async () => {
  mockStore.clear();
  jest.clearAllMocks();
  mockAppState.currentState = 'background';
  mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
  await jest.isolateModulesAsync(async () => {
    const privacy = jest.requireActual<typeof import('../state/locationPrivacy')>('../state/locationPrivacy');
    privacy.setLocationAccessContext('group-1', true, true);
    const journey = jest.requireActual<typeof import('../state/backgroundJourney')>('../state/backgroundJourney');
    try {
      await expect(journey.startBackgroundJourney({ ...baseConfig, permissionsPrepared: true })).resolves.toBe('started');
      mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
      const established = mockStore.get(BACKGROUND_JOURNEY_KEY);
      const stopsBefore = mockLocation.stopLocationUpdatesAsync.mock.calls.length;
      const startsBefore = mockLocation.startLocationUpdatesAsync.mock.calls.length;
      mockAsyncStorage.getItem.mockRejectedValueOnce(new Error('preference storage temporarily unavailable'));
      await expect(journey.startBackgroundJourney({ ...baseConfig, permissionsPrepared: true })).resolves.toBe('cancelled');
      expect(mockStore.get(BACKGROUND_JOURNEY_KEY)).toBe(established);
      expect(mockLocation.stopLocationUpdatesAsync).toHaveBeenCalledTimes(stopsBefore);
      expect(mockLocation.startLocationUpdatesAsync).toHaveBeenCalledTimes(startsBefore);
      expect(mockPurge).not.toHaveBeenCalled();
    } finally { await journey.stopBackgroundJourney(); }
  });
});

it('keeps the registered GPS owner and queue through an unavailable preference read, then accepts the next sample', async () => {
  mockStore.clear();
  jest.clearAllMocks();
  mockAppState.currentState = 'background';
  mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
  await jest.isolateModulesAsync(async () => {
    const privacy = jest.requireActual<typeof import('../state/locationPrivacy')>('../state/locationPrivacy');
    privacy.setLocationAccessContext('group-1', true, true);
    const journey = jest.requireActual<typeof import('../state/backgroundJourney')>('../state/backgroundJourney');
    let failedRead = false;
    try {
      await journey.startBackgroundJourney({ ...baseConfig, permissionsPrepared: true });
      mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
      const established = mockStore.get(BACKGROUND_JOURNEY_KEY);
      const stopsBefore = mockLocation.stopLocationUpdatesAsync.mock.calls.length;
      mockAsyncStorage.getItem.mockImplementation(async key => {
        if (key === privacy.LOCATION_SHARING_KEY && !failedRead) {
          failedRead = true;
          throw new Error('preference storage temporarily unavailable');
        }
        return mockStore.get(key) ?? null;
      });
      if (!mockTaskCallback) throw new Error('background journey task was not registered');
      const sample = { ...locationSample, timestamp: Date.now(), coords: { ...locationSample.coords, latitude: 25.01 } };
      await mockTaskCallback({ data: { locations: [sample] }, error: null });
      expect(failedRead).toBe(true);
      expect(mockStore.get(BACKGROUND_JOURNEY_KEY)).toBe(established);
      expect(mockLocation.stopLocationUpdatesAsync).toHaveBeenCalledTimes(stopsBefore);
      expect(mockPurge).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
      await mockTaskCallback({ data: { locations: [{ ...sample, timestamp: sample.timestamp + 1 }] }, error: null });
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-1', capturedAt: sample.timestamp + 1,
        coords: expect.objectContaining({ latitude: 25.01, longitude: 121 }) }));
    } finally {
      mockAsyncStorage.getItem.mockImplementation(async key => mockStore.get(key) ?? null);
      await journey.stopBackgroundJourney();
    }
  });
});
