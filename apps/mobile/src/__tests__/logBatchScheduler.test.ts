import {
  configureLogBatchScheduler,
  notifyLogRecorded,
  setLogBatchSchedulerEnabled,
  stopLogBatchScheduler,
  __resetLogBatchSchedulerForTests,
  LOG_BATCH_MAX_WAIT_MS,
} from '../state/logBatchScheduler';

describe('logBatchScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetLogBatchSchedulerForTests();
  });

  afterEach(() => {
    stopLogBatchScheduler();
    __resetLogBatchSchedulerForTests();
    jest.useRealTimers();
  });

  it('flushes at 100 records but not at 99', async () => {
    const flush = jest.fn().mockResolvedValue({ sent: 100, remaining: 0 });
    configureLogBatchScheduler(flush);
    setLogBatchSchedulerEnabled(true);
    for (let i = 0; i < 99; i += 1) notifyLogRecorded();
    expect(flush).not.toHaveBeenCalled();
    notifyLogRecorded();
    await jest.runOnlyPendingTimersAsync();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('flushes once after fifteen minutes', async () => {
    const flush = jest.fn().mockResolvedValue({ sent: 4, remaining: 0 });
    configureLogBatchScheduler(flush);
    setLogBatchSchedulerEnabled(true);
    notifyLogRecorded();
    await jest.advanceTimersByTimeAsync(LOG_BATCH_MAX_WAIT_MS - 1);
    expect(flush).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('uses capped backoff when a batch sends nothing', async () => {
    const flush = jest.fn().mockResolvedValue({ sent: 0, remaining: 5 });
    configureLogBatchScheduler(flush);
    setLogBatchSchedulerEnabled(true);
    notifyLogRecorded();
    await jest.advanceTimersByTimeAsync(LOG_BATCH_MAX_WAIT_MS);
    expect(flush).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('does not schedule when disabled', async () => {
    const flush = jest.fn().mockResolvedValue({ sent: 1, remaining: 0 });
    configureLogBatchScheduler(flush);
    setLogBatchSchedulerEnabled(false);
    for (let i = 0; i < 100; i += 1) notifyLogRecorded();
    await jest.runOnlyPendingTimersAsync();
    expect(flush).not.toHaveBeenCalled();
  });
});
