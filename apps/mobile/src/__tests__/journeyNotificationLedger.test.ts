const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
}));
import { deliverJourneyEventOnce } from '../state/journeyNotificationLedger';

beforeEach(() => mockStorage.clear());

it('serializes different events and deduplicates repeated deliveries after module reload', async () => {
  const deliver = jest.fn(async () => 'id');
  await Promise.all([deliverJourneyEventOnce('session:a', deliver), deliverJourneyEventOnce('session:b', deliver),
    deliverJourneyEventOnce('session:a', deliver)]);
  expect(deliver).toHaveBeenCalledTimes(2);
  jest.resetModules();
  const restarted = require('../state/journeyNotificationLedger');
  await restarted.deliverJourneyEventOnce('session:a', deliver);
  expect(deliver).toHaveBeenCalledTimes(2);
});

it('releases a failed or denied scheduling claim for a later retry', async () => {
  const deliver = jest.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue('id');
  await deliverJourneyEventOnce('retry', deliver);
  await expect(deliverJourneyEventOnce('retry', deliver)).rejects.toThrow('unavailable');
  await deliverJourneyEventOnce('retry', deliver);
  await deliverJourneyEventOnce('retry', deliver);
  expect(deliver).toHaveBeenCalledTimes(3);
});
