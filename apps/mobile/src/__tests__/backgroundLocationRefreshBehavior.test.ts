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
const mockLocation = { getCurrentLocation: jest.fn() };
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
jest.mock('react-native', () => ({ AppState: mockAppState }));
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
jest.mock('../state/locationOutbox', () => ({ purgeLocationOutbox: () => mockPurgeOutbox() }));

const {
  consumePendingLocationPermission,
  consumePendingLocationRefresh,
  recoverPendingLocationRefreshes,
  rememberPendingLocationPermission,
} = require('../state/backgroundLocationRefresh') as typeof import('../state/backgroundLocationRefresh');
const { BACKGROUND_LOCATION_REFRESH_TASK } = require('../state/backgroundLocationRefresh') as typeof import('../state/backgroundLocationRefresh');
const { LOCATION_SHARING_KEY } = require('../state/locationPrivacy') as typeof import('../state/locationPrivacy');

function taskHandler(): (payload: unknown) => Promise<void> {
  if (!mockTaskCallback) throw new Error('background refresh task was not registered');
  return mockTaskCallback;
}

const fix = {
  timestamp: 123,
  accuracy: 8,
  coordinates: { latitude: 25, longitude: 121 },
};

describe('durable location refresh recovery', () => {
  beforeEach(() => {
    mockStore.clear();
    mockAppState.currentState = 'active';
    jest.clearAllMocks();
    mockLocation.getCurrentLocation.mockResolvedValue(fix);
    mockListPending.mockResolvedValue([]);
    mockAck.mockResolvedValue(true);
    mockIngest.mockImplementation(async (events: Array<{ id: string }>) => ({
      acceptedIds: events.map((event) => event.id),
      rejected: [],
    }));
  });

  it('uses one foreground fix and ACKs every accepted pending group by version', async () => {
    mockListPending.mockResolvedValue([
      { groupId: 'group-1', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:00Z' },
      { groupId: 'group-2', requestedBy: 'leader', requestedAt: '2026-08-13T00:00:01Z' },
    ]);
    await recoverPendingLocationRefreshes();

    expect(mockLocation.getCurrentLocation).toHaveBeenCalledTimes(1);
    expect(mockLocation.getCurrentLocation).toHaveBeenCalledWith(false);
    expect(mockIngest).toHaveBeenCalledTimes(1);
    expect(mockIngest.mock.calls[0][0]).toHaveLength(2);
    expect(mockAck).toHaveBeenNthCalledWith(1, 'group-1', '2026-08-13T00:00:00Z');
    expect(mockAck).toHaveBeenNthCalledWith(2, 'group-2', '2026-08-13T00:00:01Z');
    expect(mockDiagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'refresh_request_completed',
      count: 2,
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
    expect(mockDiagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      event: 'location_rejected_sharing_disabled',
    }));
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
    expect(mockIngest).toHaveBeenCalledTimes(2);
    expect(mockIngest.mock.calls[1][0][0]).toMatchObject({ groupId: 'group-2' });

    mockLocation.getCurrentLocation.mockResolvedValueOnce(null);
    await handler({ data: { data: { category: 'location_refresh', groupId: 'group-3' } }, error: null });
    await expect(consumePendingLocationRefresh('group-3')).resolves.toBe('group-3');
    await expect(consumePendingLocationRefresh('group-4')).resolves.toBeNull();
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
