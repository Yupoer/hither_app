const mockReceived = new Set<(notification: { request: { content: { data: Record<string, unknown> } } }) => void>();
const mockConstants = { executionEnvironment: 'storeClient', appOwnership: 'expo' };
const mockNativeToken = jest.fn(async () => null);
const mockNotifications = {
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: 'expo-device-token' })),
  addNotificationReceivedListener: jest.fn((listener: Parameters<typeof mockReceived.add>[0]) => {
    mockReceived.add(listener);
    return { remove: () => mockReceived.delete(listener) };
  }),
};
jest.mock('expo-notifications', () => mockNotifications);
jest.mock('expo-constants', () => ({ __esModule: true, default: mockConstants, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: (name: string) =>
  name === 'HitherNotifications' ? { getDevicePushToken: mockNativeToken } : null }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: { currentState: 'active' } }));

describe('notifications boundary remote push guard', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockReceived.clear();
    mockConstants.executionEnvironment = 'storeClient';
    mockConstants.appOwnership = 'expo';
  });
  afterEach(() => {
    expect(mockReceived.size).toBe(0);
    jest.restoreAllMocks();
  });

  it('skips remote push APIs in Android Expo Go, warns once and permits the development-build token path', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const notifications = jest.requireActual<typeof import('../native/notifications')>('../native/notifications');
    await expect(notifications.getDevicePushToken()).resolves.toBeNull();
    await expect(notifications.getDevicePushToken()).resolves.toBeNull();
    expect(mockNativeToken).not.toHaveBeenCalled();
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockNotifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Android Expo Go does not support remote push'));

    mockConstants.executionEnvironment = 'standalone';
    mockConstants.appOwnership = 'standalone';
    await expect(notifications.getDevicePushToken()).resolves.toBe('expo-device-token');
    expect(mockNativeToken).toHaveBeenCalledTimes(1);
    expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockNotifications.getDevicePushTokenAsync).toHaveBeenCalledTimes(1);
  });

  it('forwards the complete foreground payload and stops delivering after unsubscribe', () => {
    const notifications = jest.requireActual<typeof import('../native/notifications')>('../native/notifications');
    const received = jest.fn();
    const unsubscribe = notifications.addForegroundListener(received);
    const data = { category: 'journey', eventId: 'legacy-event', eventIdV2: 'canonical-event', recipientId: 'actor-a' };
    expect(mockReceived.size).toBe(1);
    try {
      for (const listener of mockReceived) listener({ request: { content: { data } } });
      expect(received).toHaveBeenCalledTimes(1);
      expect(received).toHaveBeenCalledWith(data);
    } finally { unsubscribe(); }
    expect(mockReceived.size).toBe(0);
    for (const listener of mockReceived) listener({ request: { content: { data } } });
    expect(received).toHaveBeenCalledTimes(1);
  });
});
