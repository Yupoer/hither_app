const mockPrefs = jest.fn();
const mockSchedule = jest.fn();
const mockStored = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStored.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStored.set(key, value); }),
}));
jest.mock('../api/services/NotificationService', () => ({ getNotificationPreferences: () => mockPrefs() }));
jest.mock('../native', () => ({ notifications: { scheduleLocalNotification: (...args: unknown[]) => mockSchedule(...args) } }));
import { notifyJourneyOperator, notifyJourneyApproach } from '../state/journeyNotifications';
import { APPROACH_FIRED_STORAGE_KEY, approachNotifyKey } from '../utils/approachNotify';

it('gates start and pause by preference, deduplicates success, and retries failed scheduling', async () => {
  mockPrefs.mockResolvedValue({ journey: false });
  await notifyJourneyOperator('start', 'stop', 'start-1', String);
  expect(mockSchedule).not.toHaveBeenCalled();
  mockPrefs.mockResolvedValue({ journey: true });
  mockSchedule.mockResolvedValueOnce(null).mockResolvedValue('notification');
  await notifyJourneyOperator('start', 'stop', 'start-1', String);
  await Promise.all([
    notifyJourneyOperator('start', 'stop', 'start-1', String),
    notifyJourneyOperator('start', 'stop', 'start-1', String),
  ]);
  await notifyJourneyOperator('start', 'stop', 'start-1', String);
  expect(mockSchedule).toHaveBeenCalledTimes(2);
  await notifyJourneyOperator('pause', 'stop', 'pause-1', String);
  expect(mockSchedule).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'notif.operatorPauseTitle' }));
  await notifyJourneyOperator('start', 'stop', 'start-2', String);
  expect(mockSchedule).toHaveBeenCalledTimes(4);
});

it('suppresses stale approach at arrival and durably deduplicates concurrent approach delivery', async () => {
  mockSchedule.mockClear();
  mockSchedule.mockResolvedValue('approach-notification');
  const input = { remainingM: 150, totalM: 1000, arrivalRadiusM: 100, arrived: false, alreadyFired: false };
  await notifyJourneyApproach('trip-1', 'nearby-stop', 'Park', { ...input, remainingM: 80 });
  expect(mockSchedule).not.toHaveBeenCalled();
  await Promise.all([
    notifyJourneyApproach('trip-1', 'nearby-stop', 'Park', input),
    notifyJourneyApproach('trip-1', 'nearby-stop', 'Park', input),
  ]);
  await notifyJourneyApproach('trip-1', 'nearby-stop', 'Park', input);
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mockStored.get('@hither/journey-notification-ledger-v1')!)).toContain(`approach:${approachNotifyKey('trip-1', 'nearby-stop')}`);
  expect(mockSchedule).toHaveBeenCalledWith(expect.objectContaining({ data: { kind: 'approach', destinationId: 'nearby-stop' } }));
});

it('respects legacy delivery keys but recovers corrupt legacy cache and permits retry after delivery failure', async () => {
  mockSchedule.mockClear();
  const input = { remainingM: 150, totalM: 1000, arrivalRadiusM: 100, arrived: false, alreadyFired: false };
  mockStored.set(APPROACH_FIRED_STORAGE_KEY, JSON.stringify([approachNotifyKey('trip-2', 'legacy-stop')]));
  await notifyJourneyApproach('trip-2', 'legacy-stop', 'Park', input);
  expect(mockSchedule).not.toHaveBeenCalled();
  mockStored.set(APPROACH_FIRED_STORAGE_KEY, '{corrupt');
  mockSchedule.mockResolvedValueOnce(null).mockResolvedValue('notification');
  await notifyJourneyApproach('trip-2', 'retry-stop', 'Park', input);
  await notifyJourneyApproach('trip-2', 'retry-stop', 'Park', input);
  expect(mockSchedule).toHaveBeenCalledTimes(2);
});
