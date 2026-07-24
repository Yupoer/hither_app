/**
 * Ticket 02 — Supabase RPC / Edge Function / registration classification.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const recorded: Array<{ operation: string; payload: Record<string, unknown> }> = [];

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
let uuidSeq = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => {
    uuidSeq += 1;
    // Production-shaped RFC-4122 ids so sanitize retention is exercised.
    return `a1b2c3d4-e5f6-7890-abcd-${String(uuidSeq).padStart(12, '0')}`;
  }),
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
jest.mock('../native', () => ({
  metrics: { samplePerformance: jest.fn() },
}));

const consentEnabled = { value: true };
jest.mock('../state/diagnosticConsent', () => ({
  getDiagnosticConsentEnabled: jest.fn(async () => consentEnabled.value),
}));
jest.mock('../state/logBatchScheduler', () => ({
  notifyLogRecorded: jest.fn(),
  notifyErrorRecorded: jest.fn(),
}));

const rows: Array<{
  id: string;
  event_type: string;
  operation: string;
  payload: string;
  uploaded_at: number | null;
}> = [];

jest.mock('../state/hitherDatabase', () => ({
  getHitherDatabase: jest.fn(async () => ({
    runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes('INSERT OR IGNORE INTO performance_events')) {
        const [id, , , event_type, operation, payload] = params as [
          string,
          number,
          string,
          string,
          string,
          string,
        ];
        rows.push({
          id,
          event_type,
          operation,
          payload,
          uploaded_at: null,
        });
        recorded.push({
          operation,
          payload: JSON.parse(payload) as Record<string, unknown>,
        });
      }
    }),
    getAllAsync: jest.fn(async () => []),
    withTransactionAsync: jest.fn(async (w: () => Promise<void>) => w()),
  })),
}));

import { traceApi } from '../state/performance';
import { withSupabasePerformanceTracing } from '../api/instrumentedSupabase';
import { classifyUpstreamError } from '../utils/errorFingerprint';

async function flushSerial(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('traceApi classifies resolved and rejected failures', () => {
  beforeEach(() => {
    rows.length = 0;
    recorded.length = 0;
    uuidSeq = 0;
    consentEnabled.value = true;
  });

  it('records resolved Supabase { error } with operation/code/status/message', async () => {
    const result = await traceApi('api.rpc.report_straggler', async () => ({
      data: null,
      error: {
        message: 'leader role required',
        code: 'P0001',
        details: 'permission denied',
        hint: 'only leaders may report',
      },
    }));

    expect(result).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'leader role required' }),
      }),
    );
    await flushSerial();
    const err = recorded.find((r) => r.operation.includes('report_straggler'));
    expect(err).toBeTruthy();
    expect(err!.payload.outcome).toBe('failed');
    expect(err!.payload.supabaseOperation).toBe('api.rpc.report_straggler');
    expect(err!.payload.errorMessage).toEqual(
      expect.stringContaining('leader role required'),
    );
    expect(err!.payload.supabaseCode).toBe('P0001');
    expect(typeof err!.payload.durationMs).toBe('number');
    // Production UUID correlation ids must survive sanitize + outbox write.
    expect(String(err!.payload.requestId)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(String(err!.payload.requestId)).not.toContain('redacted');
  });

  it('records rejected network errors without requiring full-tracing switch', async () => {
    await expect(
      traceApi('api.from.groups', async () => {
        throw Object.assign(new Error('Network request failed'), { code: 'network' });
      }),
    ).rejects.toThrow(/Network request failed/);

    await flushSerial();
    const err = recorded.find((r) => r.operation.includes('groups'));
    expect(err).toBeTruthy();
    expect(err!.payload.outcome).toBe('failed');
    expect(err!.payload.errorMessage).toEqual(
      expect.stringMatching(/network request failed/i),
    );
  });

  it('does not create a false error event for successful responses', async () => {
    const result = await traceApi('api.from.groups', async () => ({
      data: [{ id: 'g1' }],
      error: null,
    }));
    expect(result).toEqual({ data: [{ id: 'g1' }], error: null });
    await flushSerial();
    expect(recorded.filter((r) => r.operation.includes('error'))).toHaveLength(0);
  });

  it('preserves original result for instrumented client builders', async () => {
    const builder = {
      then: (resolve: (value: unknown) => unknown) =>
        resolve({
          data: null,
          error: { message: 'leader role required', code: 'P0001' },
        }),
    };
    const client = {
      rpc: jest.fn((_name: string, _args?: unknown) => builder),
    };
    const result = await withSupabasePerformanceTracing(client).rpc(
      'report_straggler',
      {},
    );
    expect(result).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'P0001' }),
      }),
    );
    await flushSerial();
    expect(recorded.some((r) => r.operation.includes('report_straggler'))).toBe(true);
  });
});

describe('403 / 503 / 409 distinguishability', () => {
  it('leader role → authorization 403', () => {
    const c = classifyUpstreamError({
      message: 'leader role required',
      code: 'P0001',
    });
    expect(c).toMatchObject({
      subsystem: 'authorization',
      errorCode: 'leader_role_required',
      httpStatus: 403,
    });
  });

  it('Maps 503/429/401 distinguishable by code/status', () => {
    expect(
      classifyUpstreamError({
        name: 'MapsProxyError',
        code: 'upstream_unavailable',
        status: 503,
        message: 'upstream_unavailable',
      }),
    ).toMatchObject({ subsystem: 'maps', httpStatus: 503 });
    expect(
      classifyUpstreamError({
        name: 'MapsProxyError',
        code: 'quota_exceeded',
        status: 429,
        message: 'quota_exceeded',
      }),
    ).toMatchObject({ subsystem: 'maps', httpStatus: 429, errorCode: 'quota_exceeded' });
    expect(
      classifyUpstreamError({
        name: 'MapsProxyError',
        code: 'unauthorized',
        status: 401,
        message: 'unauthorized',
      }),
    ).toMatchObject({ subsystem: 'maps', httpStatus: 401, errorCode: 'unauthorized' });
  });

  it('token duplicate-key 409', () => {
    expect(
      classifyUpstreamError({
        message: 'duplicate key value violates unique constraint "device_live_activity_tokens_token"',
        code: '23505',
      }),
    ).toMatchObject({
      subsystem: 'registration',
      errorCode: 'duplicate_key',
      httpStatus: 409,
    });
  });
});

describe('source contracts — soft-fail / fallback preserved', () => {
  const liveActivity = readFileSync(
    join(__dirname, '../api/services/LiveActivityService.ts'),
    'utf8',
  );
  const mapsProxy = readFileSync(join(__dirname, '../native/googleMapsProxy.ts'), 'utf8');
  const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
  const performance = readFileSync(join(__dirname, '../state/performance.ts'), 'utf8');

  it('Live Activity soft-handles duplicate-key without throwing to UI', () => {
    expect(liveActivity).toContain('23505');
    expect(liveActivity).toContain('return;');
    // Narrow matcher — not bare table name alone.
    expect(liveActivity).toContain("code === '23505'");
    expect(liveActivity).not.toMatch(
      /message\.includes\('device_live_activity_tokens'\)\s*;/,
    );
    // No second outbox write at call site (traceApi owns the event).
    expect(liveActivity).not.toContain('recordClassifiedError');
  });

  it('Maps proxy records classified failures then throws for caller fallback', () => {
    expect(mapsProxy).toContain('recordMapsProxyFailure');
    expect(mapsProxy).toContain('maps.proxy.search');
    expect(mapsProxy).toContain('maps.proxy.directions');
    expect(mapsProxy).toContain('upstream_unavailable');
  });

  it('straggler soft-fail stays local (no root boundary escalation)', () => {
    expect(mapScreen).toContain('Soft-fail');
    expect(mapScreen).toContain('reportStraggler');
    // No second outbox error — traceApi owns api.rpc.report_straggler failures.
    expect(mapScreen).not.toContain("logError('straggler_report_failed'");
  });

  it('traceApi records errors independent of full-tracing active flag', () => {
    expect(performance).toContain('recordErrorEvent');
    expect(performance).toContain('isSupabaseErrorResult');
    // Must not early-return before wrapping work when inactive:
    expect(performance).toMatch(
      /export async function traceApi[\s\S]*?const startedAt = Date\.now\(\)/,
    );
    expect(performance).not.toMatch(
      /export async function traceApi[\s\S]*?if \(!active\) return work\(\)/,
    );
  });
});
