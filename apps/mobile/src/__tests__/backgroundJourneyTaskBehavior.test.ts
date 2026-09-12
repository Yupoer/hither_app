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
};
const locationSample = {
  timestamp: 123,
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
    jest.clearAllMocks();
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLocation.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockFlush.mockResolvedValue({ retryScheduled: 0, discarded: 0, remaining: 0 });
    mockTaskCallback = mockTaskCallback ?? undefined;
  });

  it('exposes prepare/start/load/stop through the singleton controller', async () => {
    mockLocation.hasStartedLocationUpdatesAsync
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await expect(prepareBackgroundJourneyPermissions()).resolves.toBe('ready');
    await expect(startBackgroundJourney({ ...baseConfig, permissionsPrepared: true })).resolves.toBe('started');
    await expect(loadBackgroundJourney()).resolves.toEqual(expect.objectContaining(baseConfig));
    await expect(stopBackgroundJourney()).resolves.toBeUndefined();
    expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockLocation.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
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
    await startBackgroundJourney({ ...baseConfig, navigationSessionId: null, permissionsPrepared: true });
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
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenCalled();

    await startBackgroundJourney({ ...baseConfig, permissionsPrepared: true });
    await task({ data: { locations: [locationSample] }, error: null });
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'group-1',
      source: 'background_task',
      trackingMode: expect.any(String),
    }));
    expect(mockFlush).toHaveBeenCalled();
    expect(mockAckNavigation).not.toHaveBeenCalledWith('session-1', 'arrived', expect.anything());
    expect(require('../state/arrivalSync').enqueueArrival).toHaveBeenCalled();
    expect(mockClearLiveActivities).not.toHaveBeenCalled();
    expect(mockDiagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'background_op_timeline',
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
    progress: 0, distanceMeters: 740, etaSeconds: 780, accentHex: '#F5B142',
  }));
  const { derivePersonalProgress } = require('../utils/personalProgress');
  const walking = { ...start, latitude: start.latitude - 0.0005 };
  await task({ data: { locations: [{ ...locationSample, timestamp: 124, coords: { ...locationSample.coords, ...walking } }] } });
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
jest.mock('../state/arrivalSync', () => ({ enqueueArrival: jest.fn(async () => ({ status: 'pending' })) }));
jest.mock('../api/services/GatheringWorkflowService', () => ({ fetchDestinationArrivals: jest.fn(async () => []) }));
jest.mock('../state/coreDataSync', () => ({ getCoreOperationOutbox: () => ({ listByGroup: async () => [] }), flushCoreOperationOutbox: jest.fn(async () => undefined) }));
