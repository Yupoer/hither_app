import { groupSyncDelay } from '../utils/groupSyncCadence';

it('keeps healthy realtime reconciliation to six checks in thirty minutes', () => {
  expect(groupSyncDelay(true, 0)).toBe(300_000);
  expect(30 * 60_000 / groupSyncDelay(true, 0)).toBe(6);
});

it('backs off disconnected polling and caps recovery delay', () => {
  expect([0, 1, 2, 3, 4, 10].map(n => groupSyncDelay(false, n)))
    .toEqual([60_000, 120_000, 240_000, 480_000, 900_000, 900_000]);
  expect(groupSyncDelay(true, 10)).toBe(300_000);
});
