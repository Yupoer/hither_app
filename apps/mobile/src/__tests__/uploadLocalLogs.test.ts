jest.mock('../state/diagnosticConsent', () => ({
  getDiagnosticConsentEnabled: jest.fn().mockResolvedValue(true),
}));

jest.mock('../state/diagnostics', () => ({
  diagnostics: {
    write: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue({ sent: 0, remaining: 0 }),
  },
}));

jest.mock('../state/performance', () => ({
  flushPerformance: jest.fn().mockResolvedValue({ sent: 0, remaining: 0 }),
}));

import { getDiagnosticConsentEnabled } from '../state/diagnosticConsent';
import { uploadLocalLogs } from '../utils/uploadLocalLogs';

describe('uploadLocalLogs', () => {
  beforeEach(() => {
    jest.mocked(getDiagnosticConsentEnabled).mockResolvedValue(true);
  });

  it('sends at most one diagnostic batch and one performance batch', async () => {
    const flushDiagnostics = jest.fn().mockResolvedValue({ sent: 100, remaining: 50 });
    const flushPerformance = jest.fn().mockResolvedValue({ sent: 40, remaining: 10 });

    const result = await uploadLocalLogs({
      flushDiagnostics,
      flushPerformance,
    });

    expect(flushDiagnostics).toHaveBeenCalledTimes(1);
    expect(flushPerformance).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      diagnosticSent: 100,
      diagnosticRemaining: 50,
      performanceSent: 40,
      performanceRemaining: 10,
    });
  });

  it('skips flush when consent is off', async () => {
    const flushDiagnostics = jest.fn();
    const flushPerformance = jest.fn();
    const result = await uploadLocalLogs({
      getConsent: async () => false,
      flushDiagnostics,
      flushPerformance,
    });
    expect(flushDiagnostics).not.toHaveBeenCalled();
    expect(flushPerformance).not.toHaveBeenCalled();
    expect(result).toEqual({
      diagnosticSent: 0,
      diagnosticRemaining: 0,
      performanceSent: 0,
      performanceRemaining: 0,
    });
  });

  it('does not write manual_log_upload markers', async () => {
    const writeDiagnostic = jest.fn();
    await uploadLocalLogs({
      writeDiagnostic,
      flushDiagnostics: jest.fn().mockResolvedValue({ sent: 1, remaining: 0 }),
      flushPerformance: jest.fn().mockResolvedValue({ sent: 0, remaining: 0 }),
    });
    expect(writeDiagnostic).not.toHaveBeenCalled();
  });

  it('reports remaining -1 when a flush throws', async () => {
    const result = await uploadLocalLogs({
      flushDiagnostics: jest.fn().mockResolvedValue({ sent: 3, remaining: 0 }),
      flushPerformance: jest.fn().mockRejectedValue(new Error('network')),
    });
    expect(result.performanceRemaining).toBe(-1);
    expect(result.performanceSent).toBe(0);
    expect(result.diagnosticSent).toBe(3);
  });

  it('source does not contain multi-round drain constants', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../utils/uploadLocalLogs.ts'),
      'utf8',
    );
    expect(source).not.toContain('MAX_DIAGNOSTIC_FLUSH_ROUNDS');
    expect(source).not.toContain('MAX_PERFORMANCE_FLUSH_ROUNDS');
  });
});
