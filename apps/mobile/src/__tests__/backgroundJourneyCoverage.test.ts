const mockAppState = { currentState: 'background' as string };
const store = new Map<string, string>();
const forward = (fn: (...args: any[]) => any) => (...args: any[]) => fn(...args);
const mockExpoLocation = {
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
};
const mockLocationAdapter = {
  requestForegroundPermissionsAsync: forward(mockExpoLocation.requestForegroundPermissionsAsync),
  requestBackgroundPermissionsAsync: forward(mockExpoLocation.requestBackgroundPermissionsAsync),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
};
const mockCaptureAccess = jest.fn();
const mockIsAccessCurrent = jest.fn();
const mockSubscribeAccess = jest.fn(() => jest.fn());
const mockPrepareNative = jest.fn(async () => true);
const mockObserveNative = jest.fn();
const mockTaskManager = {
  isTaskDefined: jest.fn((_name?: string) => false),
  defineTask: jest.fn((_name?: string, _handler?: (payload: unknown) => Promise<void>) => undefined),
};
const mockArrival = jest.fn();
const mockListByGroup = jest.fn(async () => []);
const mockFlushCore = jest.fn(async () => undefined);
const mockEnqueueLocation = jest.fn(async () => undefined);
const mockFlushLocation = jest.fn(async () => ({ retryScheduled: 0, discarded: 0, remaining: 0 }));
const mockPurgeLocation = jest.fn(async () => undefined);
const mockNotifyApproach = jest.fn(async () => undefined);
const mockUpdateLiveActivity = jest.fn(async () => undefined);
const mockLiveActivity = {
  updateAllGroupActivities: jest.fn(async () => undefined),
  endAllGroupActivities: jest.fn(async () => undefined),
  observeExistingActivities: jest.fn(async () => undefined),
};
const mockAckNavigation = jest.fn(async () => undefined);
const mockNavigationContext = jest.fn(async (..._args: unknown[]): Promise<any> => ({
  actorId: 'actor-1',
  hasMembership: true,
  sharingEnabled: true,
  session: null,
  target: null,
}));
const mockDiagnostics = { write: jest.fn(async () => undefined) };
const mockSetConsent = jest.fn();
const mockTaskCallback: { current?: (payload: unknown) => Promise<void> } = {};

jest.mock('react-native', () => ({ AppState: mockAppState }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { store.delete(key); }),
  },
}));
jest.mock('expo-location', () => mockExpoLocation);
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'background-location-id') }));
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: jest.fn(() => null) }));
jest.mock('expo-task-manager', () => ({
  isTaskDefined: forward(mockTaskManager.isTaskDefined),
  defineTask: (name: string, handler: (payload: unknown) => Promise<void>) => {
    mockTaskCallback.current = handler;
    mockTaskManager.defineTask(name, handler);
  },
}));
jest.mock('../native/backgroundLocation', () => ({
  backgroundLocationAdapter: mockLocationAdapter,
  nativeBackgroundAvailable: false,
  observeNativeBackgroundLocation: forward(mockObserveNative),
  prepareNativeBackgroundLocation: forward(mockPrepareNative),
}));
jest.mock('../state/locationPrivacy', () => ({
  LOCATION_SHARING_KEY: 'pref.sharingEnabled',
  captureLocationAccess: forward(mockCaptureAccess),
  isLocationAccessCurrent: forward(mockIsAccessCurrent),
  isLocationAccessEnabled: jest.fn(() => true),
  subscribeLocationAccessChanges: forward(mockSubscribeAccess),
  setLocationSharingConsent: forward(mockSetConsent),
}));
jest.mock('../state/arrivalSync', () => ({ enqueueArrival: forward(mockArrival) }));
jest.mock('../state/coreDataSync', () => ({
  getCoreOperationOutbox: () => ({ listByGroup: forward(mockListByGroup) }),
  flushCoreOperationOutbox: forward(mockFlushCore),
}));
jest.mock('../state/journeyNotifications', () => ({ notifyJourneyApproach: forward(mockNotifyApproach) }));
jest.mock('../api/services/LiveActivityService', () => ({
  updateLiveActivityProgress: forward(mockUpdateLiveActivity),
}));
jest.mock('../api/services/NavigationService', () => ({
  ackNavigationSession: forward(mockAckNavigation),
  getBackgroundNavigationContext: forward(mockNavigationContext),
}));
jest.mock('../native', () => ({ liveActivity: mockLiveActivity }));
jest.mock('../state/diagnostics', () => ({ diagnostics: mockDiagnostics }));
jest.mock('../state/locationOutbox', () => ({
  enqueueLocationOutbox: forward(mockEnqueueLocation),
  flushLocationOutbox: forward(mockFlushLocation),
  purgeLocationOutbox: forward(mockPurgeLocation),
}));

const {
  handleBackgroundLocations,
  loadBackgroundJourney,
  prepareBackgroundJourneyPermissions,
  reconcileBackgroundNavigation,
  startBackgroundJourney,
  stopBackgroundJourney,
} = require('../state/backgroundJourney') as typeof import('../state/backgroundJourney');

const baseConfig = {
  groupId: 'group-1',
  navigationSessionId: 'session-1',
  destinationId: 'destination-1',
  destination: { latitude: 25, longitude: 121 },
  arrivalRadiusMeters: 50,
  initialDistanceM: 1_000,
  actorId: 'actor-1',
  target: {
    id: 'destination-1',
    title: 'Station',
    coordinates: { latitude: 25, longitude: 121 },
    order: 0,
    day: 1,
  },
  sequence: 0,
  travelMode: 'walk' as const,
  sharingEnabled: true,
  powerMode: 'journey' as const,
  hasMembership: true,
  memberIds: ['actor-1'],
  memberArrived: [false],
  permissionsPrepared: true,
};

function location(timestamp = Date.now(), latitude = 25, accuracy = 8) {
  return {
    timestamp,
    coords: {
      latitude,
      longitude: 121,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      speed: 1,
      heading: 90,
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('background journey lifecycle and callback gate', () => {
  beforeEach(async () => {
    jest.useFakeTimers({ now: Date.now() });
    store.clear();
    jest.clearAllMocks();
    mockAppState.currentState = 'background';
    mockCaptureAccess.mockResolvedValue({ generation: 1, groupId: 'group-1', signal: new AbortController().signal });
    mockIsAccessCurrent.mockReturnValue(true);
    mockLocationAdapter.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    mockExpoLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockExpoLocation.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockExpoLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockExpoLocation.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockFlushLocation.mockResolvedValue({ retryScheduled: 0, discarded: 0, remaining: 0 });
    mockArrival.mockResolvedValue({ status: 'pending' });
    mockListByGroup.mockResolvedValue([]);
    mockNavigationContext.mockResolvedValue({
      actorId: 'actor-1', hasMembership: true, sharingEnabled: true, session: null, target: null,
    });
    await stopBackgroundJourney();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('prepares only in the foreground, handles hidden starts, and releases native ownership', async () => {
    mockAppState.currentState = 'background';
    await expect(prepareBackgroundJourneyPermissions()).resolves.toBe('permission_denied');
    mockAppState.currentState = 'active';
    await expect(prepareBackgroundJourneyPermissions(false)).resolves.toBe('ready');
    expect(mockPrepareNative).toHaveBeenCalledWith(true);

    await expect(startBackgroundJourney({ ...baseConfig, sharingEnabled: false })).resolves.toBe('hidden');
    await stopBackgroundJourney(true);
    expect(mockPrepareNative).toHaveBeenLastCalledWith(false);
  });

  it('ignores malformed, active, invalid, and duplicate native samples', async () => {
    await expect(mockTaskCallback.current?.({ data: undefined, error: new Error('native') })).resolves.toBeUndefined();
    await expect(handleBackgroundLocations({ data: { locations: [] } })).resolves.toBeUndefined();

    await startBackgroundJourney(baseConfig);
    mockAppState.currentState = 'active';
    await handleBackgroundLocations({ data: { locations: [location(1)] } });
    expect(mockEnqueueLocation).not.toHaveBeenCalled();

    mockAppState.currentState = 'background';
    await handleBackgroundLocations({ data: { locations: [location(Date.now(), 95)] } });
    await handleBackgroundLocations({ data: { locations: [location(Date.now())] } });
    expect(mockEnqueueLocation).not.toHaveBeenCalled();
  });

  it('persists arrival progress, gates uploads by cadence, and reports retry/discard results', async () => {
    await startBackgroundJourney(baseConfig);
    const task = mockTaskCallback.current!;
    mockFlushLocation.mockResolvedValueOnce({ retryScheduled: 1, discarded: 0, remaining: 1 });
    await task({ data: { locations: [location()] } });
    expect(mockArrival).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'group-1', actorId: 'actor-1',
    }));
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenCalledWith(expect.objectContaining({
      navigationSessionId: 'session-1', memberArrived: [false],
    }));
    expect(mockEnqueueLocation).toHaveBeenCalledWith(expect.objectContaining({ source: 'background_task' }));
    expect(mockNotifyApproach).toHaveBeenCalled();
    expect(mockDiagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'location_upload_failed', errorCode: 'retry_scheduled',
    }));

    mockFlushLocation.mockResolvedValueOnce({ retryScheduled: 0, discarded: 1, remaining: 0 });
    jest.advanceTimersByTime(10_000);
    await task({ data: { locations: [location(Date.now(), 25.001)] } });
    expect(mockDiagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'location_upload_discarded', errorCode: 'permanent_reject',
    }));
    const saved = await loadBackgroundJourney();
    expect(saved?.sequence).toBeGreaterThan(0);
  });

  it('confirms an accurate arrival and completes an acknowledged solo journey', async () => {
    await startBackgroundJourney({ ...baseConfig, completeSolo: true });
    const task = mockTaskCallback.current!;
    mockArrival.mockResolvedValueOnce({ status: 'acked' });
    await task({ data: { locations: [location()] } });
    expect(mockLiveActivity.endAllGroupActivities).toHaveBeenCalled();
  });

  it('coalesces control reconciliation and stops stale background sessions', async () => {
    await startBackgroundJourney(baseConfig);
    mockNavigationContext.mockResolvedValueOnce({
      actorId: 'other', hasMembership: false, sharingEnabled: false, session: null, target: null,
    });
    await reconcileBackgroundNavigation('group-1');
    expect(mockSetConsent).toHaveBeenCalledWith(false);
    expect(mockPurgeLocation).toHaveBeenCalled();

    await startBackgroundJourney(baseConfig);
    mockNavigationContext.mockResolvedValueOnce({
      actorId: 'actor-1', hasMembership: true, sharingEnabled: true, session: null, target: null,
    });
    await reconcileBackgroundNavigation('group-1');
    expect(mockLiveActivity.endAllGroupActivities).toHaveBeenCalled();

    await startBackgroundJourney(baseConfig);
    mockNavigationContext.mockResolvedValueOnce({
      actorId: 'actor-1', hasMembership: true, sharingEnabled: true,
      session: { id: 'session-2', expiresAt: '2026-09-20T00:00:00Z', destination: { arrivalRadiusMeters: 50 } },
      target: { id: 'destination-2', title: 'New', coordinates: { latitude: 25, longitude: 121 }, order: 1, day: 1 },
    });
    await reconcileBackgroundNavigation('group-1');
    expect(mockLiveActivity.observeExistingActivities).toHaveBeenCalled();
    expect(mockLocationAdapter.startLocationUpdatesAsync).toHaveBeenCalled();
  });
});
