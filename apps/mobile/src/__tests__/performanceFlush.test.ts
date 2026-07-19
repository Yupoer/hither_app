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
          .sort((a, b) => a.timestamp - b.timestamp)
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

jest.mock('expo-asset', () => ({}));

jest.mock('../native', () => ({
  metrics: {
    sampleNativeMetrics: jest.fn().mockResolvedValue(null),
  },
}));

import {
  configurePerformanceTracing,
  flushPerformance,
} from '../state/performance';
import { getHitherDatabase } from '../state/hitherDatabase';

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
});
