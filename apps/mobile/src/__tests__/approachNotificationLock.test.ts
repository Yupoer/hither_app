const mockAppState = { currentState: 'background' };
const mockLocked = jest.fn();
const mockSchedule = jest.fn(async (..._args: unknown[]) => 'notification');
const mockHandler = jest.fn();
jest.mock('react-native', () => ({ AppState: mockAppState, Platform: { OS: 'ios' } }));
jest.mock('expo-constants', () => ({ __esModule: true, default: {}, ExecutionEnvironment: {} }));
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => name === 'HitherLocation' ? { isDeviceLocked: mockLocked } : null,
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: (...args: unknown[]) => mockHandler(...args),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: (...args: unknown[]) => mockSchedule(...args),
}));
import { scheduleLocalNotification } from '../native/notifications';

beforeEach(() => { mockAppState.currentState = 'background'; mockSchedule.mockClear(); });
it.each([false, null, undefined])('suppresses an approach alert when lock state is %s', async locked => {
  mockLocked.mockResolvedValue(locked);
  expect(await scheduleLocalNotification({ title: 'Almost there', data: { kind: 'approach' } })).toBeNull();
  expect(mockSchedule).not.toHaveBeenCalled();
});
it('allows a locked approach alert and leaves other notification kinds unchanged', async () => {
  mockLocked.mockResolvedValue(true);
  await scheduleLocalNotification({ title: 'Almost there', data: { kind: 'approach' } });
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  mockAppState.currentState = 'active';
  await scheduleLocalNotification({ title: 'Almost there', data: { kind: 'approach' } });
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  await scheduleLocalNotification({ title: 'Arrived', data: { kind: 'arrival' } });
  expect(mockSchedule).toHaveBeenCalledTimes(2);
});
it('suppresses an approach alert delivered after returning to the foreground', async () => {
  const handler = mockHandler.mock.calls[0][0].handleNotification;
  expect(await handler({ request: { content: { data: { kind: 'approach' } } } })).toMatchObject({
    shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false,
  });
});
