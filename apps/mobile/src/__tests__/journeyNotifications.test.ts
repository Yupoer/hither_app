const mockPrefs = jest.fn();
const mockSchedule = jest.fn();
jest.mock('../api/services/NotificationService', () => ({ getNotificationPreferences: () => mockPrefs() }));
jest.mock('../native', () => ({ notifications: { scheduleLocalNotification: (...args: unknown[]) => mockSchedule(...args) } }));
import { notifyJourneyOperator } from '../state/journeyNotifications';

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
