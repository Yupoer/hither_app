import { legacyForegroundHandler } from './fixtures/legacyForegroundNotificationHandler';
import { buildAlignedNotificationEventId } from '../utils/notificationDeliveryPolicy';
import vectors from '../../../../supabase/functions/send-push/eventId.vectors.json';

const { eventIdsFromPayload }: {
  eventIdsFromPayload: (payload: (typeof vectors)[number]['deno']) => { eventId: string; eventIdV2?: string };
} = require('../../../../supabase/functions/send-push/eventId');

const mockSetHandler = jest.fn();
jest.mock('expo-notifications', () => ({ setNotificationHandler: (...args: unknown[]) => mockSetHandler(...args) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: {}, ExecutionEnvironment: {} }));
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'active' } }));

const journeyVectors = vectors.filter(v => 'eventIdV2' in v.push);
const notification = (data: Record<string, unknown>) => ({ request: { identifier: 'journey', content: { data } } });

it.each(['push-first', 'realtime-first'])('old app suppresses the second foreground delivery from the new server, %s', async (order) => {
  legacyForegroundHandler({ setNotificationHandler: mockSetHandler }, { OS: 'ios' }, { currentState: 'active' }, jest.fn());
  const { handleNotification } = mockSetHandler.mock.calls.at(-1)[0];
  const first = journeyVectors.find(v => v.name === 'first journey start')!;
  const push = { category: 'journey', ...eventIdsFromPayload(first.deno) };
  // Golden protocol identity produced by the app shipped before this migration.
  const realtime = { category: 'journey', eventId: 'journey:g1:going::going' };
  const deliveries = order === 'push-first' ? [push, realtime] : [realtime, push];
  expect(await handleNotification(notification(deliveries[0]))).toMatchObject({ shouldShowBanner: true, shouldPlaySound: true });
  expect(await handleNotification(notification(deliveries[1]))).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
});

it.each(['push-first', 'realtime-first'])('new app presents each lifecycle once across both paths, %s', async (order) => {
  jest.resetModules();
  require('../native/notifications');
  const { handleNotification } = mockSetHandler.mock.calls.at(-1)[0];
  for (const vector of journeyVectors) {
    const push = { category: 'journey', ...eventIdsFromPayload(vector.deno) };
    const realtime = { category: 'journey', eventId: buildAlignedNotificationEventId(vector.mobile) };
    const deliveries = order === 'push-first' ? [push, realtime] : [realtime, push];
    expect(await handleNotification(notification(deliveries[0]))).toMatchObject({ shouldShowBanner: true, shouldPlaySound: true });
    expect(await handleNotification(notification(deliveries[1]))).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
    expect(await handleNotification(notification(push))).toMatchObject({ shouldShowBanner: false, shouldPlaySound: false });
  }
});
