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

    await mockAsyncStorage.setItem(
      BACKGROUND_JOURNEY_KEY,
      JSON.stringify({ ...baseConfig, navigationSessionId: null, sharingEnabled: false }),
    );
    expect(mockStore.get(BACKGROUND_JOURNEY_KEY)).toEqual(expect.any(String));
    await expect(mockAsyncStorage.getItem(BACKGROUND_JOURNEY_KEY)).resolves.toEqual(expect.any(String));
    await expect(loadBackgroundJourney()).resolves.toEqual(expect.objectContaining({
      sharingEnabled: false,
    }));
    expect(mockAsyncStorage.getItem).toHaveBeenCalledWith(BACKGROUND_JOURNEY_KEY);
    await task({ data: { locations: [locationSample] }, error: null });
    expect(mockPurge).toHaveBeenCalled();
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenCalled();

    await mockAsyncStorage.setItem(BACKGROUND_JOURNEY_KEY, JSON.stringify(baseConfig));
    await task({ data: { locations: [locationSample] }, error: null });
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'group-1',
      source: 'background_task',
      trackingMode: expect.any(String),
    }));
    expect(mockFlush).toHaveBeenCalled();
    expect(mockAckNavigation).toHaveBeenCalledWith(
      'session-1',
      'arrived',
      expect.objectContaining({ distanceM: 0 }),
    );
    expect(mockClearLiveActivities).toHaveBeenCalledWith({ groupIds: ['group-1'] });
    expect(mockDiagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'background_op_timeline',
    }));
  });
});
