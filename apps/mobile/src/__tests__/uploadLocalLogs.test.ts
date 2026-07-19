jest.mock('../state/diagnostics', () => ({
  diagnostics: {
    write: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue({ sent: 0, remaining: 0 }),
  },
}));

jest.mock('../state/performance', () => ({
  flushPerformance: jest.fn().mockResolvedValue({ sent: 0, remaining: 0 }),
}));

import { uploadLocalLogs } from '../utils/uploadLocalLogs';

describe('uploadLocalLogs', () => {
  it('drains diagnostic batches until remaining is zero', async () => {
    const flushDiagnostics = jest
      .fn()
      .mockResolvedValueOnce({ sent: 100, remaining: 50 })
      .mockResolvedValueOnce({ sent: 50, remaining: 0 });
    const flushPerformance = jest.fn().mockResolvedValue({ sent: 0, remaining: 0 });
    const writeDiagnostic = jest.fn().mockResolvedValue(undefined);

    const result = await uploadLocalLogs({
      writeDiagnostic,
      flushDiagnostics,
      flushPerformance,
    });

    expect(flushDiagnostics).toHaveBeenCalledTimes(2);
    expect(flushPerformance).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      diagnosticSent: 150,
      diagnosticRemaining: 0,
      performanceSent: 0,
      performanceRemaining: 0,
    });
    expect(writeDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'manual_log_upload' }),
    );
    expect(writeDiagnostic).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'manual_log_upload_done' }),
    );
  });

  it('drains performance across batches until empty', async () => {
    const flushPerformance = jest
      .fn()
      .mockResolvedValueOnce({ sent: 100, remaining: 250 })
      .mockResolvedValueOnce({ sent: 100, remaining: 150 })
      .mockResolvedValueOnce({ sent: 100, remaining: 50 })
      .mockResolvedValueOnce({ sent: 50, remaining: 0 });

    const result = await uploadLocalLogs({
      writeDiagnostic: jest.fn().mockResolvedValue(undefined),
      flushDiagnostics: jest.fn().mockResolvedValue({ sent: 0, remaining: 0 }),
      flushPerformance,
    });

    expect(flushPerformance).toHaveBeenCalledTimes(4);
    expect(result.performanceSent).toBe(350);
    expect(result.performanceRemaining).toBe(0);
  });

  it('stops when a flush sends nothing while remaining stays positive', async () => {
    const flushDiagnostics = jest.fn().mockResolvedValue({ sent: 0, remaining: 12 });
    const result = await uploadLocalLogs({
      writeDiagnostic: jest.fn().mockResolvedValue(undefined),
      flushDiagnostics,
      flushPerformance: jest.fn().mockResolvedValue({ sent: 0, remaining: 0 }),
    });
    expect(flushDiagnostics).toHaveBeenCalledTimes(1);
    expect(result.diagnosticSent).toBe(0);
    expect(result.diagnosticRemaining).toBe(12);
  });

  it('reports performance remaining -1 when flush throws', async () => {
    const result = await uploadLocalLogs({
      writeDiagnostic: jest.fn().mockResolvedValue(undefined),
      flushDiagnostics: jest.fn().mockResolvedValue({ sent: 3, remaining: 0 }),
      flushPerformance: jest.fn().mockRejectedValue(new Error('network')),
    });
    expect(result.performanceRemaining).toBe(-1);
    expect(result.performanceSent).toBe(0);
    expect(result.diagnosticSent).toBe(3);
  });

  it('respects max diagnostic rounds', async () => {
    const flushDiagnostics = jest.fn().mockResolvedValue({ sent: 100, remaining: 999 });
    await uploadLocalLogs({
      writeDiagnostic: jest.fn().mockResolvedValue(undefined),
      flushDiagnostics,
      flushPerformance: jest.fn().mockResolvedValue({ sent: 0, remaining: 0 }),
      maxDiagnosticRounds: 3,
      maxPerformanceRounds: 1,
    });
    expect(flushDiagnostics).toHaveBeenCalledTimes(3);
  });

  it('marks remaining negative when diagnostic flush throws', async () => {
    const result = await uploadLocalLogs({
      writeDiagnostic: jest.fn().mockResolvedValue(undefined),
      flushDiagnostics: jest.fn().mockRejectedValue(new Error('offline')),
      flushPerformance: jest.fn().mockResolvedValue({ sent: 0, remaining: 0 }),
    });
    expect(result.diagnosticRemaining).toBe(-1);
  });
});
