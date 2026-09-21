const mockActor = jest.fn(async () => 'actor-a');
jest.mock('../api/services/_helpers', () => ({ requireLocalActorId: () => mockActor() }));
const mockSetHandler = jest.fn();
jest.mock('expo-notifications', () => ({ setNotificationHandler: (...args: unknown[]) => mockSetHandler(...args) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: {}, ExecutionEnvironment: {} }));
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'active' } }));

it('presents an arrival only once when Realtime and push both deliver it', async () => {
  require('../native/notifications');
  const { handleNotification } = mockSetHandler.mock.calls[0][0];
  const notification = (eventId: string) => ({ request: { content: { data: { eventId } } } });
  expect(await handleNotification(notification('arrival:one'))).toMatchObject({ shouldShowBanner: true, shouldPlaySound: true });
  expect(await handleNotification(notification('arrival:one'))).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
  expect(await handleNotification(notification('arrival:two'))).toMatchObject({ shouldShowBanner: true });
});

it('uses the app notice for foreground arrivals without a duplicate system banner', async () => {
  const { clearAppNotices, subscribeAppNotices } = require('../state/appNotice');
  clearAppNotices();
  const seen = jest.fn();
  const unsubscribe = subscribeAppNotices(seen);
  const { handleNotification } = mockSetHandler.mock.calls[0][0];
  const value = { request: { identifier: 'n', content: {
    title: 'Arrived', body: 'Ada arrived', data: { eventId: 'arrival:foreground', category: 'arrival', recipientId: 'actor-a' },
  } } };
  expect(await handleNotification(value)).toMatchObject({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: true });
  expect(seen.mock.calls.at(-1)[0]).toMatchObject({ title: 'Arrived', message: 'Ada arrived' });
  expect(await handleNotification(value)).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
  expect(seen.mock.calls.filter(([notice]: any[]) => notice !== null)).toHaveLength(1);
  unsubscribe();
});

it('delivers in-app arrival even without OS permission and suppresses its later push duplicate', async () => {
  const { scheduleLocalNotification } = require('../native/notifications');
  const input = { title: 'Arrived', body: 'Ada arrived', data: { eventId: 'arrival:local-first', category: 'arrival', recipientId: 'actor-a' } };
  // This module mock intentionally has no permission/scheduling methods.
  expect(await scheduleLocalNotification(input)).toBe('arrival:local-first');
  const { handleNotification } = mockSetHandler.mock.calls[0][0];
  expect(await handleNotification({ request: { content: input } })).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
});

it('suppresses delayed arrivals for another account without consuming the current actor event', async () => {
  const { handleNotification } = mockSetHandler.mock.calls[0][0];
  const value = { request: { identifier: 'cross-account', content: { title: 'Private arrival', data: {
    category: 'arrival', recipientId: 'actor-a', eventId: 'cross-account-event',
  } } } };
  mockActor.mockResolvedValueOnce('actor-b');
  expect(await handleNotification(value)).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
  expect(await handleNotification(value)).toMatchObject({ shouldPlaySound: true });
  value.request.content.data.recipientId = '';
  expect(await handleNotification(value)).toMatchObject({ shouldPlaySound: false });
});
