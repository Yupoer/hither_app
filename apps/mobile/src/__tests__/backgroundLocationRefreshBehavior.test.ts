const mockQueuedGps: Array<{ id: string }> = [];
const mockOriginalReceipt = jest.fn();
const mockSyncRequest = jest.fn();
jest.mock('../api/services/_helpers', () => ({ requireUserId: async () => 'actor-a' }));
jest.mock('../state/groupSync', () => ({
 getAcceptedLocationReceipt: (...args: unknown[]) => mockOriginalReceipt(...args),
 syncGroup: async ({ groupId, refresh }: any) => {
  mockSyncRequest({ groupId, refresh });
  const events = mockQueuedGps.splice(0);
  const result = events.length ? await mockIngest(events) : { acceptedIds: [], rejected: [] };
  const access = await require('../state/locationPrivacy').captureLocationAccess(groupId);
  const refreshAcknowledgements = [];
  for (const ack of refresh.acknowledgements) {
   const accepted = access && (result.acceptedIds.includes(ack.eventId) || mockOriginalReceipt())
    ? await mockAck(groupId, ack.requestedAt) : false;
   refreshAcknowledgements.push({ ...ack, accepted: accepted === true });
  }
  return { refreshAcknowledgements };
 },
}));
const mockLoadBackgroundJourney = jest.fn();
const mockHasBackgroundTask = jest.fn();
jest.mock('../state/backgroundJourney', () => ({
  loadBackgroundJourney: () => mockLoadBackgroundJourney(),
  reconcileBackgroundNavigation: jest.fn(async () => {}),
}));
jest.mock('../native/backgroundLocation', () => ({
  backgroundLocationAdapter: { hasStartedLocationUpdatesAsync: () => mockHasBackgroundTask() },
}));
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
const mockAppState = { currentState: 'active' as string };
const mockLocation = { getCurrentLocation: jest.fn(), getBackgroundRefreshLocation: jest.fn() };
let mockTaskCallback: ((payload: unknown) => Promise<void>) | undefined;
const mockTaskManager = {
  isTaskDefined: jest.fn(() => false),
  defineTask: jest.fn((_name: string, handler: (payload: unknown) => Promise<void>) => {
    mockTaskCallback = handler;
  }),
};
const mockNotifications = { registerTaskAsync: jest.fn(async () => undefined) };
const mockCrypto = { randomUUID: jest.fn(() => `event-${Math.random()}`) };
const mockListPending = jest.fn();
const mockAck = jest.fn();
const mockIngest = jest.fn();
const mockDiagnostics = {
  write: jest.fn(async () => undefined),
  flush: jest.fn(async () => undefined),
};
const mockPurgeOutbox = jest.fn(async () => undefined);

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('react-native', () => ({ AppState: mockAppState, Platform: { OS: 'ios' } }));
jest.mock('expo-task-manager', () => mockTaskManager);
jest.mock('expo-notifications', () => mockNotifications);
jest.mock('expo-crypto', () => mockCrypto);
jest.mock('../native', () => ({ location: mockLocation }));
jest.mock('../api/services/LocationService', () => ({
  ackMyLocationRefresh: (...args: unknown[]) => mockAck(...args),
  ingestLocationBatch: (...args: unknown[]) => mockIngest(...args),
  listMyPendingLocationRefreshes: (...args: unknown[]) => mockListPending(...args),
}));
jest.mock('../state/diagnostics', () => ({ diagnostics: mockDiagnostics }));
jest.mock('../state/locationOutbox', () => ({ purgeLocationOutbox: () => mockPurgeOutbox(), enqueueLocationOutbox: async (event: {id:string}) => { mockQueuedGps.push(event); } }));

const {
  consumePendingLocationPermission,
  consumePendingLocationRefresh,
  recoverPendingLocationRefreshes,
  recoverPendingLocationRefreshFromSample,
  rememberPendingLocationPermission,
} = require('../state/backgroundLocationRefresh') as typeof import('../state/backgroundLocationRefresh');
const { BACKGROUND_LOCATION_REFRESH_TASK } = require('../state/backgroundLocationRefresh') as typeof import('../state/backgroundLocationRefresh');
const { LOCATION_SHARING_KEY, setLocationAccessContext, setLocationSharingConsent } = require('../state/locationPrivacy') as typeof import('../state/locationPrivacy');

function taskHandler(): (payload: unknown) => Promise<void> {
  if (!mockTaskCallback) throw new Error('background refresh task was not registered');
  return mockTaskCallback;
}

const fix = {
  timestamp: Date.parse('2026-08-13T00:00:02Z'),
  accuracy: 8,
  coordinates: { latitude: 25, longitude: 121 },
};

describe('durable location refresh recovery', () => {
  beforeEach(() => {
    mockStore.clear();
    mockQueuedGps.length = 0;
    mockOriginalReceipt.mockReset();
    setLocationAccessContext('group-1', true, true);
    mockAppState.currentState = 'active';
    jest.clearAllMocks();
    mockLoadBackgroundJourney.mockResolvedValue(null);
    mockHasBackgroundTask.mockResolvedValue(false);
    mockLocation.getCurrentLocation.mockResolvedValue(fix);
    mockLocation.getBackgroundRefreshLocation.mockResolvedValue(fix);
    mockListPending.mockResolvedValue([]);
    mockAck.mockResolvedValue(true);
    mockIngest.mockImplementation(async (events: Array<{ id: string }>) => ({
      acceptedIds: events.map((event) => event.id),
      rejected: [],
    }));
  });

  it('uses one foreground fix and ACKs only the currently shared group by version', async () => {
    mockListPending.mockResolvedValue([
      { groupId: 'group-1', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:00Z' },
      { groupId: 'group-2', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:01Z' },
    ]);
    await recoverPendingLocationRefreshes();

    expect(mockLocation.getCurrentLocation).toHaveBeenCalledTimes(1);
    expect(mockLocation.getCurrentLocation).toHaveBeenCalledWith(false);
    expect(mockIngest).toHaveBeenCalledTimes(1);
    expect(mockIngest.mock.calls[0][0]).toHaveLength(1);
    expect(mockAck).toHaveBeenNthCalledWith(1, 'group-1', '2026-08-13T00:00:00Z');
    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(mockDiagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'refresh_request_completed',
      count: 1,
    }));
  });

  it('does not obtain a fix while sharing is disabled or when no pending rows exist', async () => {
    await recoverPendingLocationRefreshes();
    expect(mockLocation.getCurrentLocation).not.toHaveBeenCalled();

    mockListPending.mockResolvedValue([
      { groupId: 'group-1', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:00Z' },
    ]);
    await mockAsyncStorage.setItem(LOCATION_SHARING_KEY, 'false');
    await recoverPendingLocationRefreshes();
    expect(mockLocation.getCurrentLocation).not.toHaveBeenCalled();

  });

  it('uses foreground commands from an ordinary exchange without relisting or recursively starting recovery', async () => {
    const pending = [{ groupId: 'group-1', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:00.123456Z' }];
    const flight = recoverPendingLocationRefreshes(pending);
    expect(recoverPendingLocationRefreshes(pending)).toBe(flight);
    await flight;
    expect(mockListPending).not.toHaveBeenCalled();
    expect(mockLocation.getCurrentLocation).toHaveBeenCalledTimes(1);
    expect(mockAck).toHaveBeenCalledWith('group-1', pending[0].requestedAt);
    await recoverPendingLocationRefreshes([]);
    expect(mockListPending).not.toHaveBeenCalled();
    expect(mockLocation.getCurrentLocation).toHaveBeenCalledTimes(1);
  });

  it('keeps the durable row when the foreground fix or upload fails', async () => {
    mockListPending.mockResolvedValue([
      { groupId: 'group-1', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:00Z' },
    ]);
    mockLocation.getCurrentLocation.mockResolvedValueOnce(null);
    await recoverPendingLocationRefreshes();
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockDiagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'refresh_request_timeout',
      errorCode: 'foreground_no_fix',
    }));

    mockLocation.getCurrentLocation.mockResolvedValueOnce(fix);
    mockIngest.mockRejectedValueOnce(new Error('offline'));
    await recoverPendingLocationRefreshes();
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockDiagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'refresh_request_timeout',
      errorCode: 'foreground_upload_failed',
    }));
  });

  it('never emits completed for a rejected upload or an unconfirmed ACK', async () => {
    mockListPending.mockResolvedValue([{ groupId: 'group-1', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:00Z' }]);
    mockIngest.mockResolvedValueOnce({ acceptedIds: [], rejected: [{ id: 'x', reason: 'stale_sample' }] });
    await recoverPendingLocationRefreshes();
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockDiagnostics.write).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'refresh_request_completed' }));
    mockAck.mockResolvedValueOnce(false);
    await recoverPendingLocationRefreshes();
    expect(mockDiagnostics.write).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'refresh_request_completed' }));
  });

  it('does not upload a foreground refresh when sharing is revoked during GPS acquisition', async () => {
    mockListPending.mockResolvedValue([{ groupId: 'group-1', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:00Z' }]);
    mockLocation.getCurrentLocation.mockImplementationOnce(async () => {
      setLocationSharingConsent(false);
      return fix;
    });
    await recoverPendingLocationRefreshes();
    expect(mockIngest).not.toHaveBeenCalled();
    expect(mockAck).not.toHaveBeenCalled();
  });

  it('retains a pending refresh if sharing is revoked during its upload', async () => {
    mockListPending.mockResolvedValue([{ groupId: 'group-1', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:00Z' }]);
    mockIngest.mockImplementationOnce(async (events: Array<{ id: string }>) => {
      setLocationSharingConsent(false);
      return { acceptedIds: events.map(event => event.id), rejected: [] };
    });
    await recoverPendingLocationRefreshes();
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockDiagnostics.write).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'refresh_request_completed' }));
  });

  it('finishes a timed-out locked-screen refresh on the next real sample without acquiring a second fix', async () => {
    mockAppState.currentState = 'background';
    mockLocation.getBackgroundRefreshLocation.mockResolvedValueOnce(null);
    mockListPending.mockResolvedValue([{ groupId: 'group-1', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:00Z' }]);
    await taskHandler()({ data: { data: { category: 'location_refresh', groupId: 'group-1' } }, error: null });
    expect(mockStore.has('@hither/pending-location-refresh')).toBe(true);
    await recoverPendingLocationRefreshFromSample('group-1', { ...fix, timestamp: Date.now() + 1 });
    expect(mockLocation.getBackgroundRefreshLocation).toHaveBeenCalledTimes(1);
    expect(mockAck).toHaveBeenCalledWith('group-1', '2026-08-13T00:00:00Z');
    expect(mockIngest).toHaveBeenCalledWith([expect.objectContaining({ source: 'refresh_request' })]);
    expect(mockStore.has('@hither/pending-location-refresh')).toBe(false);
  });

  it('answers a peer refresh from the next fix of the existing iOS journey task', async () => {
    mockAppState.currentState = 'background';
    mockLoadBackgroundJourney.mockResolvedValueOnce({ groupId: 'group-1', powerMode: 'journey' });
    mockHasBackgroundTask.mockResolvedValueOnce(true);
    const requestedAt = '2026-08-13T00:00:00Z';
    mockListPending.mockResolvedValue([{ groupId: 'group-1', requestedBy: 'leader', requestedAt }]);
    await taskHandler()({ data: { data: { category: 'location_refresh', groupId: 'group-1' } }, error: null });
    expect(mockLocation.getBackgroundRefreshLocation).not.toHaveBeenCalled();
    expect(mockAck).not.toHaveBeenCalled();

    const next = { ...fix, timestamp: Date.now() + 1 };
    await recoverPendingLocationRefreshFromSample('group-1', next);
    expect(mockIngest).toHaveBeenCalledWith([expect.objectContaining({ source: 'refresh_request', capturedAt: next.timestamp })]);
    expect(mockAck).toHaveBeenCalledWith('group-1', requestedAt);
    expect(mockStore.has('@hither/pending-location-refresh')).toBe(false);
  });

  it('leaves a refresh pending when the OS supplies a cached fix older than the request', async () => {
    mockAppState.currentState = 'background';
    mockListPending.mockResolvedValue([{ groupId: 'group-1', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:05Z' }]);
    await taskHandler()({ data: { data: { category: 'location_refresh', groupId: 'group-1' } }, error: null });
    expect(mockIngest).not.toHaveBeenCalled();
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockStore.has('@hither/pending-location-refresh')).toBe(true);
  });

  it('handles headless matching rows, compatibility pushes, and legacy markers', async () => {
    const handler = taskHandler();
    mockAppState.currentState = 'background';
    mockListPending.mockResolvedValue([
      { groupId: 'group-1', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:00Z' },
    ]);
    await handler({ data: { data: { category: 'location_refresh', groupId: 'group-1' } }, error: null });
    expect(mockIngest.mock.calls[0][0]).toHaveLength(1);
    expect(mockAck).toHaveBeenCalledWith('group-1', '2026-08-13T00:00:00Z');
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('@hither/pending-location-refresh');

    mockListPending.mockResolvedValue([]);
    await handler({
      data: { data: { dataString: JSON.stringify({ category: 'location_refresh', groupId: 'group-2' }) } },
      error: null,
    });
    expect(mockIngest).toHaveBeenCalledTimes(1);
    expect(mockLocation.getBackgroundRefreshLocation).toHaveBeenCalledTimes(1);
    setLocationSharingConsent(false);
    await handler({ data: { data: { category: 'navigation_session', groupId: 'group-1' } }, error: null });
    expect(require('../state/backgroundJourney').reconcileBackgroundNavigation).not.toHaveBeenCalled();

  });

  it('retains queued locations for a registered push while access hydrates and purges after revocation', async () => {
    const handler = taskHandler();
    mockAppState.currentState = 'background';
    setLocationAccessContext(undefined, true);
    const payload = { data: { data: { category: 'location_refresh', groupId: 'group-1' } }, error: null };

    await handler(payload);

    expect(mockLocation.getBackgroundRefreshLocation).not.toHaveBeenCalled();
    expect(mockListPending).not.toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockPurgeOutbox).not.toHaveBeenCalled();
    expect(mockDiagnostics.write).not.toHaveBeenCalledWith(expect.objectContaining({
      event: 'location_rejected_sharing_disabled',
    }));

    setLocationAccessContext(null, false);
    await handler(payload);

    expect(mockLocation.getBackgroundRefreshLocation).not.toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
    expect(mockPurgeOutbox).toHaveBeenCalledTimes(1);
    expect(mockDiagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'location_rejected_sharing_disabled',
    }));
  });

  it('ignores a delayed group A push without deleting group B queued locations', async () => {
    const original = { id: 'group-b-pending-gps', groupId: 'group-b' };
    const queued = [original];
    mockPurgeOutbox.mockImplementation(async () => { queued.length = 0; });
    mockAppState.currentState = 'background';
    setLocationAccessContext('group-b', true, true);
    try {
      await taskHandler()({ data: { data: { category: 'location_refresh', groupId: 'group-a' } }, error: null });
      expect(queued).toEqual([original]);
      expect(mockPurgeOutbox).not.toHaveBeenCalled();
      expect(mockLocation.getBackgroundRefreshLocation).not.toHaveBeenCalled();
      expect(mockListPending).not.toHaveBeenCalled();
      expect(mockIngest).not.toHaveBeenCalled();
      expect(mockAck).not.toHaveBeenCalled();
    } finally { mockPurgeOutbox.mockImplementation(async () => undefined); }
  });

  it('skips a registered push while preference storage is unavailable without purging or acquiring GPS', async () => {
    mockAppState.currentState = 'background';
    mockAsyncStorage.getItem.mockRejectedValueOnce(new Error('preference storage temporarily unavailable'));
    await taskHandler()({ data: { data: { category: 'location_refresh', groupId: 'group-1' } }, error: null });
    expect(mockPurgeOutbox).not.toHaveBeenCalled();
    expect(mockLocation.getBackgroundRefreshLocation).not.toHaveBeenCalled();
    expect(mockListPending).not.toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockDiagnostics.write).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'location_rejected_sharing_disabled' }));
  });

  it('consumes permission markers exactly once and ignores malformed refresh data', async () => {
    await expect(consumePendingLocationPermission()).resolves.toBe(false);
    await rememberPendingLocationPermission();
    await expect(consumePendingLocationPermission()).resolves.toBe(true);
    await expect(consumePendingLocationPermission()).resolves.toBe(false);

    await mockAsyncStorage.setItem('@hither/pending-location-refresh', '{bad');
    await expect(consumePendingLocationRefresh()).resolves.toBeNull();
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('@hither/pending-location-refresh');
  });

  it('registers the expected native task name', () => {
    expect(BACKGROUND_LOCATION_REFRESH_TASK).toBe('hither-background-location-refresh');
    expect(mockTaskCallback).toEqual(expect.any(Function));
  });
});

it('uses returned pending rows without a push marker or list read and reuses the original accepted receipt', async () => {
  setLocationAccessContext('group-1', true, true);
  mockAck.mockResolvedValue(true);
  mockQueuedGps.length = 0;
  mockStore.clear();
  mockAppState.currentState = 'background';
  const sample = { ...fix, timestamp: Date.now() + 1 };
  const requestedAt = '2026-08-13T00:00:00.123456Z';
  const pending = [{ groupId: 'group-1', requestedBy: 'leader', requestedAt }];
  mockOriginalReceipt.mockReturnValue({ id: 'original-event', groupId: 'group-1', capturedAt: sample.timestamp, receivedAt: '2026-08-13T00:00:01Z' });
  mockIngest.mockClear(); mockAck.mockClear(); mockListPending.mockClear(); mockSyncRequest.mockClear();
  await recoverPendingLocationRefreshFromSample('group-1', sample, pending);
  expect(mockIngest).not.toHaveBeenCalled();
  expect(mockQueuedGps).toEqual([]);
  expect(mockAck).toHaveBeenCalledWith('group-1', requestedAt);
  expect(mockSyncRequest).toHaveBeenCalledWith({ groupId: 'group-1', refresh: { acknowledgements: [{ requestedAt, eventId: 'original-event' }] } });
  expect(mockListPending).not.toHaveBeenCalled();
  expect(mockStore.has('@hither/pending-location-refresh')).toBe(false);
});

it('treats an empty returned pending packet as authoritative without a redundant list read', async () => {
  setLocationAccessContext('group-1', true, true);
  mockStore.clear();
  mockAppState.currentState = 'background';
  const sample = { ...fix, timestamp: Date.now() + 1 };
  mockStore.set('@hither/pending-location-refresh', JSON.stringify({ groupId: 'group-1', requestedAt: sample.timestamp - 1 }));
  mockListPending.mockClear(); mockSyncRequest.mockClear();
  await recoverPendingLocationRefreshFromSample('group-1', sample, []);
  expect(mockListPending).not.toHaveBeenCalled();
  expect(mockSyncRequest).not.toHaveBeenCalled();
  expect(mockStore.has('@hither/pending-location-refresh')).toBe(false);
});

it('retains recovery intent after a returned pending command has an unconfirmed ACK', async () => {
  setLocationAccessContext('group-1', true, true);
  mockStore.clear();
  mockQueuedGps.length = 0;
  mockAppState.currentState = 'background';
  const sample = { ...fix, timestamp: Date.now() + 1 };
  const pending = [{ groupId: 'group-1', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:00.123456Z' }];
  mockOriginalReceipt.mockReturnValue({ id: 'original-event', groupId: 'group-1', capturedAt: sample.timestamp, receivedAt: '2026-08-13T00:00:01Z' });
  mockAck.mockResolvedValueOnce(false).mockResolvedValue(true);
  mockListPending.mockClear().mockResolvedValue(pending);
  await expect(recoverPendingLocationRefreshFromSample('group-1', sample, pending)).rejects.toThrow('refresh_ack_not_confirmed');
  expect(mockStore.has('@hither/pending-location-refresh')).toBe(true);
  expect(mockListPending).not.toHaveBeenCalled();
  await recoverPendingLocationRefreshFromSample('group-1', { ...sample, timestamp: Date.now() + 2 });
  expect(mockListPending).toHaveBeenCalledTimes(1);
  expect(mockStore.has('@hither/pending-location-refresh')).toBe(false);
});
