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
let mockNativeAvailable = false;
const mockObserveNative = jest.fn();
const mockTaskManager = {
  isTaskDefined: jest.fn((_name?: string) => false),
  defineTask: jest.fn((_name?: string, _handler?: (payload: unknown) => Promise<void>) => undefined),
};
const mockArrival = jest.fn();
function savedArrival(
  input: Parameters<typeof import('../state/arrivalSync').enqueueArrival>[0],
  status: import('../types/coreData').CoreOperationStatus = 'pending',
): import('../types/coreData').CoreOperation {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const createdAt = Date.parse(occurredAt);
  return {
    id: 'saved-arrival', actorId: input.actorId, groupId: input.groupId,
    entityType: 'itinerary', entityId: input.destination.id, entityVersion: 1,
    operationType: 'record_arrival', status, sequence: 1,
    createdAt, updatedAt: createdAt, nextAttemptAt: createdAt, attempts: 0, conflictResult: null,
    payload: { actorId: input.actorId, userId: input.userId, destination: input.destination,
      navigationSessionId: input.navigationSessionId ?? null, occurredAt,
      arrivedAt: input.arrivedAt, completeSolo: input.completeSolo },
  };
}
const mockListByGroup = jest.fn(async (): Promise<any[]> => []);
const mockFlushCore = jest.fn(async () => undefined);
const mockComplete = jest.fn(async (...args: any[]): Promise<any> =>
  args[0].isCurrent() ? { status: 'pending', id: 'complete-1' } : null);
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
const mockRecoverRefreshSample = jest.fn(async (..._args: unknown[]) => undefined);

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
  get nativeBackgroundAvailable() { return mockNativeAvailable; },
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
jest.mock('../state/arrivalSync', () => ({
  enqueueArrival: forward(mockArrival),
  projectArrivals: jest.requireActual('../state/arrivalSync').projectArrivals,
}));
jest.mock('../state/coreDataSync', () => ({
  getCoreOperationOutbox: () => ({ listByGroup: forward(mockListByGroup) }),
  flushCoreOperationOutbox: forward(mockFlushCore),
  enqueueDestinationComplete: forward(mockComplete),
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
jest.mock('../state/backgroundLocationRefresh', () => ({
  recoverPendingLocationRefreshFromSample: forward(mockRecoverRefreshSample),
}));

const {
  handleBackgroundLocations,
  loadBackgroundManualUndo,
  loadBackgroundJourney,
  prepareBackgroundJourneyPermissions,
  reconcileBackgroundNavigation,
  rememberBackgroundManualUndo,
  releaseBackgroundManualUndo,
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
    mockNativeAvailable = false;
    mockCaptureAccess.mockResolvedValue({ generation: 1, groupId: 'group-1', signal: new AbortController().signal });
    mockIsAccessCurrent.mockReturnValue(true);
    mockLocationAdapter.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    mockExpoLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockExpoLocation.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockExpoLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockExpoLocation.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockFlushLocation.mockResolvedValue({ retryScheduled: 0, discarded: 0, remaining: 0 });
    mockArrival.mockImplementation(async input => savedArrival(input));
    mockComplete.mockImplementation(async input => input.isCurrent() ? { status: 'pending', id: 'complete-1' } : null);
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

  it('uploads locked-screen presence without a navigation session and retains its cadence', async () => {
    await expect(startBackgroundJourney({ ...baseConfig, navigationSessionId: null,
      powerMode: 'allDay', appState: 'background' })).resolves.toBe('started');
    expect(mockLocationAdapter.startLocationUpdatesAsync).toHaveBeenCalledWith(
      expect.any(String), expect.objectContaining({ accuracy: 2, pausesUpdatesAutomatically: false }));
    const now = Date.now();
    await handleBackgroundLocations({ data: { locations: [location(now)] } });
    expect(mockEnqueueLocation).toHaveBeenCalledWith(expect.objectContaining({
      navigationSessionId: null, source: 'background_task', trackingMode: 'passiveBackground',
    }));
    expect(mockArrival).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockNotifyApproach).not.toHaveBeenCalled();
    expect(mockLiveActivity.updateAllGroupActivities).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    await handleBackgroundLocations({ data: { locations: [location(Date.now(), 25.0001)] } });
    expect(mockEnqueueLocation).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(61_000);
    await handleBackgroundLocations({ data: { locations: [location(Date.now(), 25.0002)] } });
    expect(mockEnqueueLocation).toHaveBeenCalledTimes(2);
    expect((await loadBackgroundJourney())?.powerMode).toBe('allDay');
  });

  it('refuses presence without foreground-prepared permission or membership', async () => {
    await expect(startBackgroundJourney({ ...baseConfig, navigationSessionId: null,
      appState: 'background', permissionsPrepared: false })).resolves.toBe('permission_denied');
    expect(mockExpoLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    await expect(startBackgroundJourney({ ...baseConfig, navigationSessionId: null,
      hasMembership: false })).resolves.toBe('hidden');
    expect(await loadBackgroundJourney()).toBeNull();
  });

  it('revoking access stops presence and purges pending location uploads', async () => {
    await startBackgroundJourney({ ...baseConfig, navigationSessionId: null, powerMode: 'allDay' });
    mockCaptureAccess.mockResolvedValue(null);
    await handleBackgroundLocations({ data: { locations: [location()] } });
    expect(await loadBackgroundJourney()).toBeNull();
    expect(mockPurgeLocation).toHaveBeenCalled();
    expect(mockEnqueueLocation).not.toHaveBeenCalled();
  });

  it.each(['foreground', 'new-session', 'revoked-access'] as const)(
    'does not resurrect the old presence owner after delayed navigation teardown: %s', async change => {
      await startBackgroundJourney(baseConfig);
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>(resolve => { entered = resolve; });
      mockLiveActivity.endAllGroupActivities.mockImplementationOnce(() => {
        entered();
        return new Promise<undefined>(resolve => { release = () => resolve(undefined); });
      });
      const reconciliation = reconcileBackgroundNavigation('group-1');
      await waiting;
      if (change === 'foreground') {
        mockAppState.currentState = 'active';
        await stopBackgroundJourney();
      } else if (change === 'new-session') {
        await startBackgroundJourney({ ...baseConfig, navigationSessionId: 'new-session' });
      } else {
        mockIsAccessCurrent.mockReturnValue(false);
      }
      mockLocationAdapter.startLocationUpdatesAsync.mockClear();
      release();
      await reconciliation;
      expect(mockLocationAdapter.startLocationUpdatesAsync).not.toHaveBeenCalled();
      const config = await loadBackgroundJourney();
      if (change === 'foreground') expect(config).toBeNull();
      else expect(config?.navigationSessionId).toBe(change === 'new-session' ? 'new-session' : 'session-1');
    },
  );

  it('retains the current presence scope when membership moves to a subgroup', async () => {
    await startBackgroundJourney({ ...baseConfig, navigationSessionId: null, scopeSubgroupId: null });
    await startBackgroundJourney({ ...baseConfig, navigationSessionId: null, scopeSubgroupId: 'subgroup-2' });
    expect(await loadBackgroundJourney()).toEqual(expect.objectContaining({
      powerMode: 'allDay', navigationSessionId: null, scopeSubgroupId: 'subgroup-2',
    }));
    await reconcileBackgroundNavigation('group-1');
    expect(mockNavigationContext).toHaveBeenCalledWith('group-1', 'subgroup-2');
  });

  it('ending navigation downgrades to presence and keeps uploading after the transition', async () => {
    await startBackgroundJourney(baseConfig);
    await reconcileBackgroundNavigation('group-1');
    expect(await loadBackgroundJourney()).toEqual(expect.objectContaining({
      powerMode: 'allDay', navigationSessionId: null,
    }));
    jest.clearAllMocks();
    await handleBackgroundLocations({ data: { locations: [location()] } });
    expect(mockEnqueueLocation).toHaveBeenCalledWith(expect.objectContaining({ navigationSessionId: null }));
    expect(mockArrival).not.toHaveBeenCalled();
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

  it.each([false, true])('finishes granted permission reads after locking with prepared ownership (native=%s)', async (nativeAvailable) => {
    mockAppState.currentState = 'active';
    mockNativeAvailable = nativeAvailable;
    let finishRead!: (value: { status: string }) => void;
    mockExpoLocation.getBackgroundPermissionsAsync.mockReturnValueOnce(
      new Promise(resolve => { finishRead = resolve; }),
    );
    const preparation = prepareBackgroundJourneyPermissions(false);
    await settle(); await settle();
    expect(mockExpoLocation.getBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockPrepareNative.mock.invocationCallOrder[0]).toBeLessThan(
      mockExpoLocation.getForegroundPermissionsAsync.mock.invocationCallOrder[0],
    );
    mockAppState.currentState = 'background';
    finishRead({ status: 'granted' });
    await expect(preparation).resolves.toBe('ready');
    expect(mockPrepareNative).toHaveBeenCalledTimes(1);
    expect(mockExpoLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockExpoLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    await expect(startBackgroundJourney({ ...baseConfig, navigationSessionId: null,
      powerMode: 'allDay', appState: 'background', permissionsPrepared: true,
    })).resolves.toBe('started');
    expect(await loadBackgroundJourney()).toEqual(expect.objectContaining({
      powerMode: 'allDay', permissionsPrepared: true,
    }));
  });

  it('does not call native preparation again from background if the early preparation failed', async () => {
    mockAppState.currentState = 'active';
    mockPrepareNative.mockResolvedValueOnce(false);
    let finishRead!: (value: { status: string }) => void;
    mockExpoLocation.getBackgroundPermissionsAsync.mockReturnValueOnce(
      new Promise(resolve => { finishRead = resolve; }),
    );
    const preparation = prepareBackgroundJourneyPermissions(false);
    await settle(); await settle();
    mockAppState.currentState = 'background';
    finishRead({ status: 'granted' });
    await expect(preparation).resolves.toBe('permission_denied');
    expect(mockPrepareNative).toHaveBeenCalledTimes(1);
    expect(mockLocationAdapter.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('rejects the prepared owner if actor/group/privacy access changes during permission reads', async () => {
    mockAppState.currentState = 'active';
    let finishRead!: (value: { status: string }) => void;
    mockExpoLocation.getBackgroundPermissionsAsync.mockReturnValueOnce(
      new Promise(resolve => { finishRead = resolve; }),
    );
    const preparation = prepareBackgroundJourneyPermissions(false);
    await settle(); await settle();
    mockIsAccessCurrent.mockReturnValue(false);
    mockAppState.currentState = 'background';
    finishRead({ status: 'granted' });
    await expect(preparation).resolves.toBe('permission_denied');
    expect(mockPrepareNative).toHaveBeenCalledTimes(1);
    expect(mockLocationAdapter.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('never opens a missing permission prompt after the app backgrounds during a read', async () => {
    mockAppState.currentState = 'active';
    mockPrepareNative.mockResolvedValueOnce(false);
    let finishRead!: (value: { status: string }) => void;
    mockExpoLocation.getForegroundPermissionsAsync.mockReturnValueOnce(
      new Promise(resolve => { finishRead = resolve; }),
    );
    const preparation = prepareBackgroundJourneyPermissions(true);
    await settle(); await settle();
    mockAppState.currentState = 'background';
    finishRead({ status: 'denied' });
    await expect(preparation).resolves.toBe('permission_denied');
    expect(mockExpoLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockExpoLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockPrepareNative).toHaveBeenCalledTimes(1);
  });

  it('does not request background permission if the foreground permission prompt returns after locking', async () => {
    mockAppState.currentState = 'active';
    mockPrepareNative.mockResolvedValueOnce(false);
    mockExpoLocation.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    mockExpoLocation.getBackgroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    let finishPrompt!: (value: { status: string }) => void;
    mockExpoLocation.requestForegroundPermissionsAsync.mockReturnValueOnce(
      new Promise(resolve => { finishPrompt = resolve; }),
    );
    const preparation = prepareBackgroundJourneyPermissions(true);
    await settle(); await settle(); await settle();
    expect(mockExpoLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    mockAppState.currentState = 'background';
    finishPrompt({ status: 'granted' });
    await expect(preparation).resolves.toBe('permission_denied');
    expect(mockExpoLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockPrepareNative).toHaveBeenCalledTimes(1);
  });

  it('retries native preparation in foreground after a first-time permission grant', async () => {
    mockAppState.currentState = 'active';
    mockPrepareNative.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockExpoLocation.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    mockExpoLocation.getBackgroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    await expect(prepareBackgroundJourneyPermissions(true)).resolves.toBe('ready');
    expect(mockPrepareNative).toHaveBeenCalledTimes(2);
    expect(mockExpoLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockExpoLocation.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
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
    expect(mockEnqueueLocation).not.toHaveBeenCalled();
    const valid = location(Date.now(), 25.02);
    await handleBackgroundLocations({ data: { locations: [valid] } });
    expect(mockEnqueueLocation).toHaveBeenCalledTimes(1);
    await handleBackgroundLocations({ data: { locations: [valid] } });
    expect(mockEnqueueLocation).toHaveBeenCalledTimes(1);
  });

  it('delivers background estimates at 5 seconds and cloud progress at 15 seconds', async () => {
    await startBackgroundJourney(baseConfig);
    mockNavigationContext.mockResolvedValue({ actorId: baseConfig.actorId, hasMembership: true,
      sharingEnabled: true, session: { id: baseConfig.navigationSessionId }, target: baseConfig.target });
    const startedAt = Date.now();
    const sample = async (elapsed: number) => {
      jest.setSystemTime(startedAt + elapsed);
      await handleBackgroundLocations({ data: { locations: [location(Date.now(), 25.01 + elapsed / 1e9)] } });
    };
    await sample(0);
    const nativeCount = mockLiveActivity.updateAllGroupActivities.mock.calls.length;
    const cloudCount = mockUpdateLiveActivity.mock.calls.length;
    expect(nativeCount).toBeGreaterThan(0);
    expect(cloudCount).toBeGreaterThan(0);
    await sample(4999);
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenCalledTimes(nativeCount);
    await sample(5000);
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenCalledTimes(nativeCount + 1);
    expect(mockUpdateLiveActivity).toHaveBeenCalledTimes(cloudCount);
    await sample(14999);
    expect(mockUpdateLiveActivity).toHaveBeenCalledTimes(cloudCount);
    await sample(15000);
    expect(mockUpdateLiveActivity).toHaveBeenCalledTimes(cloudCount + 1);
  });

  it('sends a changed personal receipt immediately inside the background throttle', async () => {
    await startBackgroundJourney(baseConfig);
    await handleBackgroundLocations({ data: { locations: [location(Date.now(), 25.01)] } });
    const count = mockLiveActivity.updateAllGroupActivities.mock.calls.length;
    jest.advanceTimersByTime(1000);
    const occurredAt = new Date().toISOString();
    const receipt = {
      operationType: 'record_arrival', entityId: baseConfig.destinationId,
      actorId: baseConfig.actorId, sequence: 42, createdAt: Date.now(), status: 'conflict',
      payload: { actorId: baseConfig.actorId, userId: baseConfig.actorId,
        navigationSessionId: baseConfig.navigationSessionId, arrived: true, occurredAt },
    };
    // An older undo must not win over the newer personal arrival receipt.
    mockListByGroup.mockResolvedValue([receipt,
      { ...receipt, sequence: 41, payload: { ...receipt.payload, arrived: false } }]);
    await handleBackgroundLocations({ data: { locations: [location(Date.now(), 25.01)] } });
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenCalledTimes(count + 1);
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenLastCalledWith(expect.objectContaining({
      personalArrived: true, personalArrivalSequence: 42, personalArrivalAtMs: Date.parse(occurredAt),
      memberArrived: [false],
    }));
  });

  it('keeps a personal receipt and location uploads when cloud progress and optional notifications fail', async () => {
    await startBackgroundJourney(baseConfig);
    mockNavigationContext.mockResolvedValue({ actorId: baseConfig.actorId, hasMembership: true,
      sharingEnabled: true, session: { id: baseConfig.navigationSessionId }, target: baseConfig.target });
    mockArrival.mockImplementationOnce(async input => savedArrival(input, 'conflict'));
    mockUpdateLiveActivity.mockRejectedValueOnce(new Error('network unavailable'));
    mockNotifyApproach.mockRejectedValueOnce(new Error('notification unavailable'));
    mockFlushCore.mockRejectedValueOnce(new Error('sync unavailable'));
    await expect(handleBackgroundLocations({ data: { locations: [location()] } })).resolves.toBeUndefined();
    await settle();
    expect(mockUpdateLiveActivity).toHaveBeenCalledTimes(1);
    expect(mockNotifyApproach).toHaveBeenCalledTimes(1);
    expect(mockFlushCore).toHaveBeenCalledTimes(1);
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenLastCalledWith(expect.objectContaining({
      personalArrived: true, memberArrived: [false], progress: 1,
    }));
    expect(mockEnqueueLocation).toHaveBeenCalledTimes(1);
    expect(mockFlushLocation).toHaveBeenCalledTimes(1);
    expect((await loadBackgroundJourney())?.personalArrivalAtMs).toBe(Date.now());
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('persists arrival progress, gates uploads by cadence, and reports retry/discard results', async () => {
    await startBackgroundJourney(baseConfig);
    const task = mockTaskCallback.current!;
    mockFlushLocation.mockResolvedValueOnce({ retryScheduled: 1, discarded: 0, remaining: 1 });
    await task({ data: { locations: [location()] } });
    expect(mockArrival).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'group-1', actorId: 'actor-1', navigationSessionId: 'session-1',
    }));
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenCalledWith(expect.objectContaining({
      navigationSessionId: 'session-1', memberArrived: [true], progress: 1,
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

  it('honors a foreground undo tombstone after the ACKed row is compacted', async () => {
    const marker = {
      actorId: 'actor-1',
      groupId: 'group-1', destinationId: 'destination-1', navigationSessionId: 'undo-session',
      operationId: 'undo-1', occurredAt: '2026-09-20T01:00:00.000Z', suppressed: true,
    } as const;
    await startBackgroundJourney({ ...baseConfig, navigationSessionId: 'undo-session' });
    // Simulate the ACKed undo having already been compacted. The callback
    // must observe the persisted tombstone, not depend on start-time state or
    // the outbox row still being present.
    await rememberBackgroundManualUndo(marker);
    mockListByGroup.mockResolvedValueOnce([]);
    await mockTaskCallback.current!({ data: { locations: [location()] } });
    expect(mockArrival).not.toHaveBeenCalled();
    expect((await loadBackgroundJourney())?.manualUndoSuppressed).toBe(true);
  });

  it('does not carry an undo tombstone across accounts on the same device', async () => {
    await rememberBackgroundManualUndo({
      actorId: 'actor-1', groupId: 'group-1', destinationId: 'destination-1',
      navigationSessionId: 'shared-session', operationId: 'undo-1',
      occurredAt: '2026-09-20T01:00:00.000Z', suppressed: true,
    });
    await startBackgroundJourney({
      ...baseConfig,
      actorId: 'actor-2',
      navigationSessionId: 'shared-session',
      memberIds: ['actor-2'],
    });
    mockListByGroup.mockResolvedValueOnce([]);
    await mockTaskCallback.current!({ data: { locations: [location()] } });
    expect(mockArrival).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor-2' }));
  });

  it('keeps a released marker so an old outbox undo cannot re-suppress re-entry', async () => {
    const marker = {
      actorId: 'actor-1', groupId: 'group-1', destinationId: 'destination-1',
      navigationSessionId: 'released-session', operationId: 'undo-1',
      occurredAt: '2026-09-20T01:00:00.000Z', suppressed: true,
    } as const;
    await rememberBackgroundManualUndo(marker);
    await releaseBackgroundManualUndo({ ...marker, suppressed: false });
    await expect(loadBackgroundManualUndo(
      'actor-1', 'group-1', 'destination-1', 'released-session',
    )).resolves.toEqual(expect.objectContaining({ operationId: 'undo-1', suppressed: false }));
  });

  it('confirms an accurate arrival without ending the leader-controlled journey', async () => {
    await startBackgroundJourney({ ...baseConfig, completeSolo: true });
    const task = mockTaskCallback.current!;
    mockArrival.mockImplementationOnce(async input => savedArrival(input, 'acked'));
    await task({ data: { locations: [location()] } });
    expect(mockLiveActivity.endAllGroupActivities).not.toHaveBeenCalled();
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

  async function startCurrent(config = baseConfig) {
    await startBackgroundJourney(config);
    mockNavigationContext.mockResolvedValue({ actorId: config.actorId, hasMembership: true,
      sharingEnabled: true, session: { id: config.navigationSessionId }, target: config.target });
    await reconcileBackgroundNavigation(config.groupId);
    jest.clearAllMocks();
  }

  it('recovers a changed locked-screen target within the journey control budget without losing precision', async () => {
    await startCurrent({ ...baseConfig, highAccuracy: true } as typeof baseConfig);
    const target = { ...baseConfig.target, id: 'destination-2', coordinates: { latitude: 25.003, longitude: 121 } };
    mockNavigationContext.mockResolvedValue({ actorId: baseConfig.actorId, hasMembership: true,
      sharingEnabled: true, session: { id: 'session-2', destination: { arrivalRadiusMeters: 50 } }, target });
    jest.advanceTimersByTime(14_999);
    await handleBackgroundLocations({ data: { locations: [location(Date.now(), 25.002)] } });
    expect(mockNavigationContext).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await handleBackgroundLocations({ data: { locations: [location(Date.now(), 25.002)] } });
    expect(mockNavigationContext).toHaveBeenCalledTimes(1);
    expect(await loadBackgroundJourney()).toMatchObject({ navigationSessionId: 'session-2',
      destinationId: target.id, highAccuracy: true });
    expect(mockArrival).not.toHaveBeenCalled();
  });

  it('presence keeps the precision preference for a later journey while retaining the low-frequency profile', async () => {
    await startBackgroundJourney({ ...baseConfig, powerMode: 'allDay', highAccuracy: true,
      navigationSessionId: null });
    expect(await loadBackgroundJourney()).toMatchObject({ highAccuracy: true, powerMode: 'allDay' });
    expect(mockLocationAdapter.startLocationUpdatesAsync).toHaveBeenLastCalledWith(expect.any(String),
      expect.objectContaining({ accuracy: 2, timeInterval: 150_000 }));
    mockNavigationContext.mockResolvedValue({ actorId: baseConfig.actorId, hasMembership: true,
      sharingEnabled: true, session: { id: 'session-2', destination: { arrivalRadiusMeters: 50 } }, target: baseConfig.target });
    await reconcileBackgroundNavigation(baseConfig.groupId);
    expect(await loadBackgroundJourney()).toMatchObject({ highAccuracy: true, powerMode: 'journey' });
    expect(mockLocationAdapter.startLocationUpdatesAsync).toHaveBeenLastCalledWith(expect.any(String),
      expect.objectContaining({ accuracy: 5, timeInterval: 5_000 }));
  });

  it('passes a real presence fix to a pending refresh without starting another GPS owner', async () => {
    await startBackgroundJourney({ ...baseConfig, navigationSessionId: null, powerMode: 'allDay' });
    store.set('@hither/pending-location-refresh', JSON.stringify({ groupId: baseConfig.groupId, requestedAt: Date.now() - 1 }));
    const sample = location();
    await handleBackgroundLocations({ data: { locations: [sample] } });
    expect(mockRecoverRefreshSample).toHaveBeenCalledWith(baseConfig.groupId, expect.objectContaining({
      timestamp: sample.timestamp, coordinates: { latitude: 25, longitude: 121 },
    }));
    expect(mockLocationAdapter.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  it('processes an out-of-order enter/exit batch without losing the arrival or waiting for ACK', async () => {
    await startCurrent();
    const now = Date.now();
    await handleBackgroundLocations({ data: { locations: [
      location(now, 25.002), location(now - 2_000), location(now - 3_000, 25.002),
    ] } });
    expect(mockArrival).toHaveBeenCalledTimes(1);
    expect(mockArrival).toHaveBeenCalledWith(expect.objectContaining({ occurredAt: new Date(now - 2_000).toISOString() }));
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenCalledWith(expect.objectContaining({ memberArrived: [true], progress: 1 }));
    expect((await loadBackgroundJourney())?.sequence).toBe(3);
    expect((await loadBackgroundJourney())?.arrivedMemberIds).toEqual(['actor-1']);
  });

  it('accepts the first fresh accurate fix when navigation starts inside the radius', async () => {
    await startCurrent({ ...baseConfig, initialDistanceM: 0 });
    await handleBackgroundLocations({ data: { locations: [location()] } });
    expect(mockArrival).toHaveBeenCalledTimes(1);
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenCalledWith(expect.objectContaining({ progress: 1, memberArrived: [true] }));
    expect(mockFlushCore).toHaveBeenCalled();
  });

  it('does not arrive from old, future, unknown or inaccurate fixes', async () => {
    await startCurrent();
    const now = Date.now();
    await handleBackgroundLocations({ data: { locations: [
      location(now - 20_000), location(now - 3, 25, 150),
      { ...location(now - 2), coords: { ...location().coords, accuracy: null } },
      location(now + 2_001),
    ] } });
    expect(mockArrival).not.toHaveBeenCalled();
    expect((await loadBackgroundJourney())?.arrivedMemberIds).toEqual([]);
  });

  it('requires a fresh accurate exit after undo, then accepts re-entry in the same batch', async () => {
    await startCurrent();
    const now = Date.now();
    await rememberBackgroundManualUndo({ actorId: 'actor-1', groupId: 'group-1',
      destinationId: 'destination-1', navigationSessionId: 'session-1',
      operationId: 'undo', occurredAt: new Date(now - 5_000).toISOString(), suppressed: true });
    await handleBackgroundLocations({ data: { locations: [
      location(now - 20_000, 25.002), location(now - 3_000, 25.002, 150), location(now - 2_000),
    ] } });
    expect(mockArrival).not.toHaveBeenCalled();
    expect((await loadBackgroundJourney())?.manualUndoSuppressed).toBe(true);
    await handleBackgroundLocations({ data: { locations: [location(now - 1_000, 25.002), location(now)] } });
    expect(mockArrival).toHaveBeenCalledTimes(1);
    expect((await loadBackgroundJourney())?.manualUndoSuppressed).toBe(false);
  });

  it('a freshly saved terminal personal receipt cannot immediately enqueue team completion', async () => {
    await startCurrent({ ...baseConfig, leaderId: 'actor-1', navigationMemberIds: ['actor-1', 'teammate'],
      memberIds: ['actor-1', 'teammate'], memberArrived: [false, true],
      arrivedMemberIds: ['teammate'] } as typeof baseConfig);
    mockArrival.mockImplementationOnce(async input => savedArrival(input, 'conflict'));
    await handleBackgroundLocations({ data: { locations: [location()] } });
    expect(mockArrival).toHaveBeenCalledTimes(1);
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: 1, memberArrived: [false, true], gatheredCount: 1,
    }));
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockLiveActivity.endAllGroupActivities).not.toHaveBeenCalled();
  });

  it.each(['conflict', 'acked'] as const)('keeps personal receipt %s separate from all-arrived leader completion', async status => {
    await startCurrent({ ...baseConfig, leaderId: 'actor-1', navigationMemberIds: ['actor-1', 'teammate'],
      memberIds: ['actor-1', 'teammate'], memberArrived: [true, true],
      arrivedMemberIds: ['actor-1', 'teammate'] } as typeof baseConfig);
    mockListByGroup.mockResolvedValue([{
      id: 'receipt', actorId: 'actor-1', operationType: 'record_arrival', status,
      entityId: 'destination-1', sequence: 1, createdAt: 1,
      payload: { actorId: 'actor-1', userId: 'actor-1', navigationSessionId: 'session-1', arrived: true },
    }]);
    await handleBackgroundLocations({ data: { locations: [location()] } });
    expect(mockArrival).not.toHaveBeenCalled();
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: 1, memberArrived: [status !== 'conflict', true], gatheredCount: status === 'conflict' ? 1 : 2,
    }));
    if (status === 'conflict') {
      expect(mockComplete).not.toHaveBeenCalled();
      expect(mockLiveActivity.endAllGroupActivities).not.toHaveBeenCalled();
      expect(await loadBackgroundJourney()).toEqual(expect.objectContaining({
        powerMode: 'journey', navigationSessionId: 'session-1', arrivedMemberIds: ['teammate'],
      }));
    } else {
      expect(mockComplete).toHaveBeenCalledWith(expect.objectContaining({ reason: 'all_arrived' }));
      expect(mockLiveActivity.endAllGroupActivities).toHaveBeenCalledTimes(1);
    }
  });

  it.each([{ navigationMemberIds: ['actor-1'] }, { navigationMemberIds: ['actor-1', 'teammate'] }])('leader durably completes all scoped members including a solo team: %j', async ({ navigationMemberIds }) => {
    await startCurrent({ ...baseConfig, leaderId: 'actor-1', navigationMemberIds,
      arrivedMemberIds: navigationMemberIds.filter(id => id !== 'actor-1') } as typeof baseConfig);
    await handleBackgroundLocations({ data: { locations: [location()] } });
    expect(mockComplete).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor-1',
      groupId: 'group-1', destinationId: 'destination-1', sessionId: 'session-1', subgroupId: null,
      reason: 'all_arrived' }));
    expect(mockArrival.mock.invocationCallOrder[0]).toBeLessThan(mockComplete.mock.invocationCallOrder[0]);
    // Terminal UI and durable completion never wait for a cloud-progress request.
    expect(mockUpdateLiveActivity).not.toHaveBeenCalled();
    expect(mockLiveActivity.endAllGroupActivities).toHaveBeenCalled();
    expect(await loadBackgroundJourney()).toEqual(expect.objectContaining({ powerMode: 'allDay', navigationSessionId: null }));
  });

  it('nonleader arrival and incomplete leader counts keep the journey open', async () => {
    await startCurrent({ ...baseConfig, leaderId: 'teammate', navigationMemberIds: ['actor-1'] } as typeof baseConfig);
    await handleBackgroundLocations({ data: { locations: [location()] } });
    expect(mockComplete).not.toHaveBeenCalled();
    await stopBackgroundJourney();
    await startCurrent({ ...baseConfig, leaderId: 'actor-1', navigationMemberIds: ['actor-1', 'missing'] } as typeof baseConfig);
    await handleBackgroundLocations({ data: { locations: [location()] } });
    expect(mockComplete).not.toHaveBeenCalled();
    expect(await loadBackgroundJourney()).not.toBeNull();
  });

  it('keeps every callback queued while a previous native fix is still being processed', async () => {
    await startCurrent();
    const now = Date.now();
    let release!: (access: unknown) => void;
    mockCaptureAccess.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = handleBackgroundLocations({ data: { locations: [location(now - 3_000, 25.002)] } });
    await settle();
    const enter = handleBackgroundLocations({ data: { locations: [location(now - 2_000)] } });
    const exit = handleBackgroundLocations({ data: { locations: [location(now - 1_000, 25.002)] } });
    release({ generation: 1, groupId: 'group-1' });
    await Promise.all([first, enter, exit]);
    expect(mockArrival).toHaveBeenCalledTimes(1);
    expect((await loadBackgroundJourney())?.sequence).toBe(3);
  });

  it('never applies a queued old arrival/completion to a newer session', async () => {
    await startCurrent({ ...baseConfig, leaderId: 'actor-1', navigationMemberIds: ['actor-1'] } as typeof baseConfig);
    mockArrival.mockImplementationOnce(async input => {
      await startBackgroundJourney({ ...baseConfig, navigationSessionId: 'new-session' });
      return savedArrival(input);
    });
    await handleBackgroundLocations({ data: { locations: [location(Date.now() - 1), location()] } });
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockLiveActivity.updateAllGroupActivities).not.toHaveBeenCalled();
    expect((await loadBackgroundJourney())?.navigationSessionId).toBe('new-session');
  });

  it('same-session control recovery notices the last teammate arrival and completes without another GPS fix', async () => {
    await startCurrent({ ...baseConfig, leaderId: 'actor-1', navigationMemberIds: ['actor-1', 'teammate'],
      arrivedMemberIds: ['actor-1'] } as typeof baseConfig);
    mockNavigationContext.mockResolvedValue({ actorId: 'actor-1', hasMembership: true, sharingEnabled: true,
      session: { id: 'session-1' }, target: baseConfig.target, leaderId: 'actor-1',
      navigationMemberIds: ['actor-1', 'teammate'], arrivedMemberIds: ['actor-1', 'teammate'] });
    await reconcileBackgroundNavigation('group-1');
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(await loadBackgroundJourney()).toEqual(expect.objectContaining({ powerMode: 'allDay', navigationSessionId: null }));
  });

  it('persisted native timestamp rejects replay after the same journey is restarted', async () => {
    await startCurrent();
    const sample = location();
    await handleBackgroundLocations({ data: { locations: [sample] } });
    await startBackgroundJourney(baseConfig);
    jest.clearAllMocks();
    await handleBackgroundLocations({ data: { locations: [sample] } });
    expect(mockArrival).not.toHaveBeenCalled();
    expect(mockLiveActivity.updateAllGroupActivities).not.toHaveBeenCalled();
    expect((await loadBackgroundJourney())?.lastProcessedLocationAt).toBe(sample.timestamp);
  });

  it('keeps later fixes in the batch when the first durable arrival write fails', async () => {
    await startCurrent();
    mockArrival.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(handleBackgroundLocations({ data: { locations: [location(Date.now() - 1), location()] } }))
      .rejects.toThrow('storage unavailable');
    expect(mockArrival).toHaveBeenCalledTimes(2);
    expect(mockLiveActivity.updateAllGroupActivities).toHaveBeenCalledWith(expect.objectContaining({ memberArrived: [true] }));
  });

  it('completion that loses its context while saving never ends the replacement journey', async () => {
    await startCurrent({ ...baseConfig, leaderId: 'actor-1', navigationMemberIds: ['actor-1'] } as typeof baseConfig);
    mockComplete.mockImplementationOnce(async input => {
      await startBackgroundJourney({ ...baseConfig, navigationSessionId: 'replacement' });
      expect(input.isCurrent()).toBe(false);
      return null;
    });
    await handleBackgroundLocations({ data: { locations: [location()] } });
    expect(mockLiveActivity.endAllGroupActivities).not.toHaveBeenCalled();
    expect((await loadBackgroundJourney())?.navigationSessionId).toBe('replacement');
  });

  it('a compacted undo also prevents remote recovery from auto-completing', async () => {
    await startCurrent({ ...baseConfig, leaderId: 'actor-1', navigationMemberIds: ['actor-1'] } as typeof baseConfig);
    await rememberBackgroundManualUndo({ actorId: 'actor-1', groupId: 'group-1',
      destinationId: 'destination-1', navigationSessionId: 'session-1',
      occurredAt: new Date().toISOString(), suppressed: true });
    mockNavigationContext.mockResolvedValue({ actorId: 'actor-1', hasMembership: true, sharingEnabled: true,
      session: { id: 'session-1' }, target: baseConfig.target, leaderId: 'actor-1',
      navigationMemberIds: ['actor-1'], arrivedMemberIds: ['actor-1'] });
    await reconcileBackgroundNavigation('group-1');
    expect(mockComplete).not.toHaveBeenCalled();
    expect((await loadBackgroundJourney())?.arrivedMemberIds).toEqual([]);
  });
});
