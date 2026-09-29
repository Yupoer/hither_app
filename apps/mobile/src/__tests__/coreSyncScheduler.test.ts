import { createCoreSyncScheduler } from '../state/coreSyncScheduler';
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it('drains accepted FIFO heads and stops when empty without overlapping requests', async () => {
  const flush = jest.fn().mockResolvedValueOnce({ sent: 1, duplicates: 0, remaining: 1 })
    .mockResolvedValue({ sent: 1, duplicates: 0, remaining: 0 });
  const scheduler = createCoreSyncScheduler(flush);
  scheduler.wake(); scheduler.wake();
  await jest.advanceTimersByTimeAsync(500);
  expect(flush).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(500);
  expect(flush).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
  scheduler.stop();
});
it('waits for queue retry eligibility, sleeps in background and wakes on return', async () => {
  const flush = jest.fn(async () => ({ sent: 0, duplicates: 0, remaining: 2 }));
  const scheduler = createCoreSyncScheduler(flush);
  scheduler.wake();
  await jest.advanceTimersByTimeAsync(500);
  await jest.advanceTimersByTimeAsync(29_000);
  expect(flush).toHaveBeenCalledTimes(1);
  scheduler.setForeground(false);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(flush).toHaveBeenCalledTimes(1);
  scheduler.setForeground(true);
  await jest.advanceTimersByTimeAsync(500);
  expect(flush).toHaveBeenCalledTimes(2);
  scheduler.stop();
  expect(jest.getTimerCount()).toBe(0);
});
it('backs off infrastructure failures and never restarts after stop while in flight', async () => {
  let release!: (value: any) => void;
  const flush = jest.fn().mockRejectedValueOnce(new Error('disk busy'))
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const scheduler = createCoreSyncScheduler(flush);
  scheduler.wake();
  await jest.advanceTimersByTimeAsync(500);
  await jest.advanceTimersByTimeAsync(30_000);
  scheduler.wake();
  scheduler.stop();
  release({ sent: 1, duplicates: 0, remaining: 2 });
  await Promise.resolve();
  expect(flush).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});
it('wakes new work during a scheduled wait without overlapping an active flush', async () => {
  const flush = jest.fn().mockResolvedValueOnce({ sent: 0, duplicates: 0, remaining: 1 })
    .mockResolvedValue({ sent: 1, duplicates: 0, remaining: 0 });
  const scheduler = createCoreSyncScheduler(flush);
  scheduler.wake();
  await jest.advanceTimersByTimeAsync(500);
  scheduler.wake();
  await jest.advanceTimersByTimeAsync(500);
  expect(flush).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
  scheduler.stop();
});

it('expedites an in-flight wake and bounds self-notifying empty flushes', async () => {
  let release!: (value: { sent: number; duplicates: number; remaining: number }) => void;
  let scheduler!: ReturnType<typeof createCoreSyncScheduler>;
  const flush = jest.fn()
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockImplementationOnce(async () => {
      // Simulate the outbox notifying while this retry is still flushing.
      scheduler.wake();
      return { sent: 0, duplicates: 0, remaining: 0 };
    })
    .mockResolvedValue({ sent: 0, duplicates: 0, remaining: 0 });
  scheduler = createCoreSyncScheduler(flush);

  scheduler.wake();
  await jest.advanceTimersByTimeAsync(500);
  expect(flush).toHaveBeenCalledTimes(1);

  // Without the in-flight wake override this would wait 30 seconds.
  scheduler.wake();
  release({ sent: 0, duplicates: 0, remaining: 1 });
  await jest.advanceTimersByTimeAsync(500);
  expect(flush).toHaveBeenCalledTimes(2);

  // The self-notification gets one bounded empty follow-up, not a 500ms loop.
  await jest.advanceTimersByTimeAsync(500);
  expect(flush).toHaveBeenCalledTimes(3);
  await jest.advanceTimersByTimeAsync(30_000);
  expect(flush).toHaveBeenCalledTimes(3);

  scheduler.stop();
  expect(jest.getTimerCount()).toBe(0);
});
