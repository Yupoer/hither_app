const mockSetHandler = jest.fn();
jest.mock('expo-notifications', () => ({ setNotificationHandler: (...args: unknown[]) => mockSetHandler(...args) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: {}, ExecutionEnvironment: {} }));
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

it('presents an arrival only once when Realtime and push both deliver it', async () => {
  require('../native/notifications');
  const { handleNotification } = mockSetHandler.mock.calls[0][0];
  const notification = (eventId: string) => ({ request: { content: { data: { eventId } } } });
  expect(await handleNotification(notification('arrival:one'))).toMatchObject({ shouldShowBanner: true, shouldPlaySound: true });
  expect(await handleNotification(notification('arrival:one'))).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
  expect(await handleNotification(notification('arrival:two'))).toMatchObject({ shouldShowBanner: true });
});
