type PerfRow = {
  id: string;
  timestamp: number;
  session_id: string;
  event_type: 'sample' | 'trace' | 'error';
  operation: string;
  payload: string;
  attempts: number;
  uploaded_at: number | null;
};

const rows: PerfRow[] = [];

jest.mock('../state/hitherDatabase', () => ({
  getHitherDatabase: jest.fn(async () => ({
    runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes('INSERT OR IGNORE INTO performance_events')) {
        const [
          id,
          timestamp,
          session_id,
          event_type,
          operation,
          payload,
          attempts,
          uploaded_at,
        ] = params as [
          string,
          number,
          string,
          PerfRow['event_type'],
          string,
          string,
          number,
          number | null,
        ];
        if (!rows.some((row) => row.id === id)) {
          rows.push({
            id,
            timestamp,
            session_id,
            event_type,
            operation,
            payload,
            attempts,
            uploaded_at,
          });
        }
        return;
      }
      if (sql.includes('UPDATE performance_events SET uploaded_at')) {
        const [uploadedAt, id] = params as [number, string];
        const row = rows.find((item) => item.id === id);
        if (row) row.uploaded_at = uploadedAt;
        return;
      }
      if (sql.includes('UPDATE performance_events SET attempts')) {
        const [id] = params as [string];
        const row = rows.find((item) => item.id === id);
        if (row) row.attempts += 1;
        return;
      }
      if (sql.includes('DELETE FROM performance_events')) {
        return;
      }
    }),
    getAllAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes('COUNT(*)')) {
        return [{ count: rows.filter((row) => row.uploaded_at == null).length }];
      }
      if (sql.includes('WHERE uploaded_at IS NULL')) {
        const limit = typeof params[0] === 'number' ? params[0] : 100;
        return rows
          .filter((row) => row.uploaded_at == null)
          .sort((a, b) => {
            const ae = a.event_type === 'error' ? 0 : 1;
            const be = b.event_type === 'error' ? 0 : 1;
            if (ae !== be) return ae - be;
            return a.timestamp - b.timestamp;
          })
          .slice(0, limit);
      }
      return [];
    }),
    withTransactionAsync: jest.fn(async (work: () => Promise<void>) => {
      await work();
    }),
  })),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `id-${Math.random().toString(36).slice(2, 10)}`),
}));

jest.mock('expo-constants', () => ({
  nativeBuildVersion: '1',
  expoConfig: { version: '1.0.0' },
}));

jest.mock('expo-updates', () => ({
  isEnabled: false,
  isEmbeddedLaunch: true,
  updateId: null,
  runtimeVersion: '0.1.3',
}));

jest.mock('expo-asset', () => ({}));

const samplePerformance = jest.fn().mockResolvedValue({
  cpuPercent: 1,
  memoryMb: 100,
  batteryLevel: 0.8,
  thermalState: 'nominal',
});

jest.mock('../native', () => ({
  metrics: {
    sampleNativeMetrics: jest.fn().mockResolvedValue(null),
    samplePerformance: (...args: unknown[]) => samplePerformance(...args),
  },
}));

const consentEnabled = { value: true };
jest.mock('../state/diagnosticConsent', () => ({
  getDiagnosticConsentEnabled: jest.fn(async () => consentEnabled.value),
}));
jest.mock('../state/logBatchScheduler', () => ({
  notifyLogRecorded: jest.fn(),
  notifyErrorRecorded: jest.fn(),
}));

import {
  configurePerformanceTracing,
  deriveCpuPercent,
  flushPerformance,
  recordPerformanceError,
  setPerformanceAppState,
  startNavigationEnergyMonitor,
} from '../state/performance';
import { getHitherDatabase } from '../state/hitherDatabase';
import { notifyErrorRecorded } from '../state/logBatchScheduler';

async function seedPending(count: number): Promise<string[]> {
  const db = await getHitherDatabase();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `perf-${i}`;
    ids.push(id);
    await db.runAsync(
      `INSERT OR IGNORE INTO performance_events
       (id, timestamp, session_id, event_type, operation, payload, attempts, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      Date.now() + i,
      'session',
      'trace',
      'test.op',
      '{}',
      0,
      null,
    );
  }
  return ids;
}

describe('flushPerformance', () => {
  beforeEach(() => {
    rows.length = 0;
    consentEnabled.value = true;
    setPerformanceAppState('active');
  });

  it('skips flush and energy samples when consent is off', async () => {
    consentEnabled.value = false;
    await seedPending(2);
    configurePerformanceTracing(async (records) => records.map((r) => r.id));
    await expect(flushPerformance()).resolves.toEqual({ sent: 0, remaining: 0 });
    samplePerformance.mockClear();
    const stop = startNavigationEnergyMonitor({
      navigationSessionId: '00000000-0000-4000-8000-000000000001',
      trackingMode: 'teamNavigation',
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(samplePerformance).not.toHaveBeenCalled();
    stop();
  });

  it('returns sent and remaining when the uploader accepts all ids', async () => {
    const ids = await seedPending(2);
    configurePerformanceTracing(async (records) => records.map((r) => r.id));

    await expect(flushPerformance()).resolves.toEqual({ sent: 2, remaining: 0 });
    expect(ids).toHaveLength(2);
  });

  it('keeps remaining when the uploader accepts nothing', async () => {
    await seedPending(2);
    configurePerformanceTracing(async () => []);

    await expect(flushPerformance()).resolves.toEqual({ sent: 0, remaining: 2 });
  });

  it('counts only accepted ids and leaves failures pending', async () => {
    await seedPending(3);
    configurePerformanceTracing(async (records) => [records[0]!.id, records[1]!.id]);

    await expect(flushPerformance()).resolves.toEqual({ sent: 2, remaining: 1 });
  });

  it('returns remaining 0 when the queue is empty', async () => {
    configurePerformanceTracing(async () => []);
    await expect(flushPerformance()).resolves.toEqual({ sent: 0, remaining: 0 });
  });

  it('records navigation energy at start and at five-minute cadence only', async () => {
    jest.useFakeTimers();
    samplePerformance.mockClear();
    const stop = startNavigationEnergyMonitor({
      navigationSessionId: '00000000-0000-4000-8000-000000000001',
      trackingMode: 'teamNavigation',
    });

    // Allow the initial async sample to start.
    await Promise.resolve();
    await Promise.resolve();
    expect(samplePerformance).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(4 * 60_000);
    expect(samplePerformance).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(samplePerformance).toHaveBeenCalledTimes(2);

    stop();
    jest.useRealTimers();
  });

  it('queues JS errors without full-tracing TTL and prefers them on flush', async () => {
    await seedPending(1);
    await recordPerformanceError('unhandled_exception', new Error('boom'), {
      isFatal: true,
    });
    // Allow writeSerial to finish.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const errorRows = rows.filter((r) => r.event_type === 'error');
    expect(errorRows.length).toBe(1);
    expect(errorRows[0]!.operation).toBe('error.js_fatal');
    const payload = JSON.parse(errorRows[0]!.payload) as Record<string, unknown>;
    expect(payload.exceptionKind).toBe('Error');
    expect(typeof payload.stackHash).toBe('string');
    expect(payload).not.toHaveProperty('message');
    expect(payload).not.toHaveProperty('stack');
    expect(notifyErrorRecorded).toHaveBeenCalled();

    const seen: string[] = [];
    configurePerformanceTracing(async (records) => {
      seen.push(...records.map((r) => r.eventType));
      return records.map((r) => r.id);
    });
    await flushPerformance();
    expect(seen[0]).toBe('error');
  });

  it('does not queue errors when consent is off', async () => {
    consentEnabled.value = false;
    rows.length = 0;
    await recordPerformanceError('react_render', new Error('render'));
    await Promise.resolve();
    await Promise.resolve();
    expect(rows.filter((r) => r.event_type === 'error')).toHaveLength(0);
  });

  it('derives cpu percent from cumulative cpuTimeMs wall deltas', () => {
    expect(deriveCpuPercent(null, { cpuTimeMs: 100, wallMs: 1_000 })).toBeNull();
    expect(
      deriveCpuPercent(
        { cpuTimeMs: 100, wallMs: 1_000 },
        { cpuTimeMs: 150, wallMs: 2_000 },
      ),
    ).toBeCloseTo(5, 5);
    expect(
      deriveCpuPercent(
        { cpuTimeMs: 200, wallMs: 3_000 },
        { cpuTimeMs: 100, wallMs: 4_000 },
      ),
    ).toBeNull();
  });

  it('skips mid-session energy samples while backgrounded', async () => {
    samplePerformance.mockClear();
    setPerformanceAppState('background');
    const stop = startNavigationEnergyMonitor({
      navigationSessionId: '00000000-0000-4000-8000-000000000001',
      trackingMode: 'teamNavigation',
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(samplePerformance).not.toHaveBeenCalled();
    stop();
    // end sample still allowed even if background — restore for other tests
    setPerformanceAppState('active');
  });
});
