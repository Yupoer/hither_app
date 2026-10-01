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
    mockCaptureAccess.mockResolvedValue({ generation: 1, groupId: 'group-1', signal: new AbortController().signal });
    mockIsAccessCurrent.mockReturnValue(true);
    mockLocationAdapter.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    mockExpoLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockExpoLocation.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockExpoLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockExpoLocation.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockFlushLocation.mockResolvedValue({ retryScheduled: 0, discarded: 0, remaining: 0 });
    mockArrival.mockResolvedValue({ status: 'pending' });
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
    mockArrival.mockResolvedValueOnce({ status: 'acked' });
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
      location(now + 1_000),
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

  it.each([{ navigationMemberIds: ['actor-1'] }, { navigationMemberIds: ['actor-1', 'teammate'] }])('leader durably completes all scoped members including a solo team: %j', async ({ navigationMemberIds }) => {
    await startCurrent({ ...baseConfig, leaderId: 'actor-1', navigationMemberIds,
      arrivedMemberIds: navigationMemberIds.filter(id => id !== 'actor-1') } as typeof baseConfig);
    await handleBackgroundLocations({ data: { locations: [location()] } });
    expect(mockComplete).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor-1',
      groupId: 'group-1', destinationId: 'destination-1', sessionId: 'session-1', subgroupId: null,
      reason: 'all_arrived' }));
    expect(mockArrival.mock.invocationCallOrder[0]).toBeLessThan(mockComplete.mock.invocationCallOrder[0]);
    expect(mockLiveActivity.endAllGroupActivities).toHaveBeenCalled();
    expect(await loadBackgroundJourney()).toBeNull();
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
    mockArrival.mockImplementationOnce(async () => {
      await startBackgroundJourney({ ...baseConfig, navigationSessionId: 'new-session' });
      return { status: 'pending' };
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
    expect(await loadBackgroundJourney()).toBeNull();
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
