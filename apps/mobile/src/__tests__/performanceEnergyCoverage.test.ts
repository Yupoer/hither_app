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
const storage = new Map<string, string>();
let uuid = 0;
const mockDatabase = {
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    if (sql.includes('INSERT OR IGNORE INTO performance_events')) {
      const [id, timestamp, sessionId, eventType, operation, payload, attempts, uploadedAt] = params as [
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
          session_id: sessionId,
          event_type: eventType,
          operation,
          payload,
          attempts,
          uploaded_at: uploadedAt,
        });
      }
    } else if (sql.includes('UPDATE performance_events SET uploaded_at')) {
      const [uploadedAt, id] = params as [number, string];
      const row = rows.find((candidate) => candidate.id === id);
      if (row) row.uploaded_at = uploadedAt;
    } else if (sql.includes('UPDATE performance_events SET attempts')) {
      const [id] = params as [string];
      const row = rows.find((candidate) => candidate.id === id);
      if (row) row.attempts += 1;
    } else if (sql.includes('DELETE FROM performance_events WHERE uploaded_at IS NULL')) {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index]?.uploaded_at == null) rows.splice(index, 1);
      }
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
  withTransactionAsync: jest.fn(async (work: () => Promise<void>) => work()),
};
const mockConsent = jest.fn(async (..._args: unknown[]) => true);
const mockNativeSample = {
  cpuPercent: null,
  cpuTimeMs: 100,
  memoryMb: 120,
  uiFps: 60,
  frameTimeP95Ms: 16,
  missedFrameRatio: 0,
  displayMaxFps: 60,
  batteryLevel: 0.8,
  batteryState: 'unplugged',
  lowPowerMode: false,
  thermalState: 'nominal',
  appState: 'active',
  deviceModel: 'test',
  osVersion: '1',
};
const mockMetrics = {
  samplePerformance: jest.fn(async () => mockNativeSample),
};
const energyHandlers: Array<(sample: unknown) => void> = [];
const mockEnergy = {
  increment: jest.fn(),
  setAppState: jest.fn(),
  setTrackingMode: jest.fn(),
  start: jest.fn((handler: (sample: unknown) => void) => {
    energyHandlers.push(handler);
    return { stop: jest.fn() };
  }),
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => storage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { storage.set(key, value); }),
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => `perf-${++uuid}`) }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { nativeBuildVersion: '42', expoConfig: { version: '0.1.0' } },
}));
jest.mock('expo-updates', () => ({
  isEmbeddedLaunch: true,
  updateId: null,
  runtimeVersion: '56.0.0',
}));
jest.mock('../state/hitherDatabase', () => ({
  getHitherDatabase: jest.fn(async () => mockDatabase),
}));
jest.mock('../state/diagnosticConsent', () => ({
  getDiagnosticConsentEnabled: (...args: unknown[]) => mockConsent(...args),
}));
jest.mock('../state/logBatchScheduler', () => ({
  notifyErrorRecorded: jest.fn(),
  notifyLogRecorded: jest.fn(),
}));
jest.mock('../native', () => ({ metrics: mockMetrics }));
jest.mock('../state/energyObservability', () => ({ energyObservability: mockEnergy }));

import {
  clearActiveActionContext,
  configurePerformanceTracing,
  deriveCpuPercent,
  flushPerformance,
  getActiveActionContext,
  getLastRoute,
  getLastScreenName,
  getPerformancePlatform,
  isPerformanceTracingActive,
  isSupabaseErrorResult,
  markInteraction,
  purgePerformance,
  recordErrorEvent,
  recordClassifiedError,
  recordPerformanceError,
  sanitizePerformancePayload,
  setActiveActionContext,
  setLastLaunchPhase,
  setLastRoute,
  setLastScreenName,
  setPerformanceAppState,
  setPerformancePlatform,
  startNavigationEnergyMonitor,
  startPerformanceMonitor,
  traceApi,
  utf8ByteLength,
} from '../state/performance';

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

const observation = {
  kind: 'steady' as const,
  startupOffsetMs: null,
  scheduledAt: 1_000,
  appState: 'active',
  trackingMode: 'foreground',
  counters: {
    delta: {
      location_callback: 1,
      location_accepted: 1,
      route_recalc: 0,
      realtime_callback: 0,
      snapshot: 0,
      render: 0,
      network_request: 0,
    },
    cumulative: {
      location_callback: 1,
      location_accepted: 1,
      route_recalc: 0,
      realtime_callback: 0,
      snapshot: 0,
      render: 0,
      network_request: 0,
    },
    windowMs: 5_000,
  },
};

describe('performance and energy lifecycle coverage', () => {
  beforeEach(() => {
    rows.length = 0;
    storage.clear();
    uuid = 0;
    energyHandlers.length = 0;
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_PERFORMANCE_TRACING = 'full';
    mockConsent.mockResolvedValue(true);
    mockMetrics.samplePerformance.mockResolvedValue(mockNativeSample);
    setPerformanceAppState('active');
    setPerformancePlatform('unknown');
    clearActiveActionContext();
  });

  afterEach(() => {
    delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
    jest.useRealTimers();
  });

  it('keeps correlation context bounded and generation-safe', () => {
    expect(deriveCpuPercent(null, { cpuTimeMs: 1, wallMs: 1 })).toBeNull();
    expect(deriveCpuPercent({ cpuTimeMs: 10, wallMs: 100 }, { cpuTimeMs: 20, wallMs: 200 })).toBe(10);
    expect(deriveCpuPercent({ cpuTimeMs: 20, wallMs: 200 }, { cpuTimeMs: 10, wallMs: 100 })).toBeNull();
    expect(utf8ByteLength('a中😀')).toBe(8);

    setPerformancePlatform('ios');
    expect(getPerformancePlatform()).toBe('ios');
    setLastLaunchPhase('navigation_ready');
    setLastScreenName('Map'.repeat(50));
    setLastRoute('Map', 'route-123e4567-e89b-12d3-a456-426614174000');
    expect(getLastScreenName().length).toBeLessThanOrEqual(80);
    expect(getLastRoute().routeKey).toContain('id');

    const first = setActiveActionContext({ actionId: 'a', screen: 'Map', parentTraceId: 'parent' });
    const second = setActiveActionContext({ actionId: 'b', screen: 'Detail' });
    clearActiveActionContext(first.generation);
    expect(getActiveActionContext()?.actionId).toBe('b');
    clearActiveActionContext(second.generation);
    expect(getActiveActionContext()).toBeNull();

    const bounded = sanitizePerformancePayload({
      actionId: 'a',
      errorMessage: 'token=secret@example.com ' + 'x'.repeat(10_000),
      coordinates: { latitude: 25, longitude: 121 },
      unknown: 'drop',
    });
    expect(bounded).not.toHaveProperty('coordinates');
    expect(bounded).not.toHaveProperty('unknown');
    expect(JSON.stringify(bounded).length).toBeLessThan(30_000);
    expect(isSupabaseErrorResult({ error: { code: '42501' } })).toBe(true);
    expect(isSupabaseErrorResult({ error: null })).toBe(false);
  });

  it('runs independent error tracing and consent-gated queue flushing', async () => {
    await recordErrorEvent('error.test', { errorMessage: 'failed', httpStatus: 503 }, 'error-1');
    await settle();
    expect(rows.find((row) => row.id === 'error-1')?.event_type).toBe('error');

    const uploader = jest.fn(async (records: Array<{ id: string }>) => [records[0]?.id ?? 'unknown']);
    configurePerformanceTracing(uploader);
    await settle();
    expect(isPerformanceTracingActive()).toBe(true);
    await expect(flushPerformance()).resolves.toMatchObject({ sent: 1, remaining: 0 });
    expect(uploader).toHaveBeenCalledTimes(1);

    await recordPerformanceError('unhandled_exception', new Error('boom'), { isFatal: true });
    await recordClassifiedError('classified.test', new Error('classified'), { httpStatus: 503 });
    await settle();
    const fatal = rows.find((row) => row.operation === 'error.js_fatal');
    expect(fatal).toBeDefined();
    await purgePerformance();
    expect(rows.filter((row) => row.uploaded_at == null)).toHaveLength(0);

    mockConsent.mockResolvedValue(false);
    await recordErrorEvent('error.consent_off', {}, 'off');
    await expect(flushPerformance()).resolves.toEqual({ sent: 0, remaining: 0 });
    expect(rows.some((row) => row.id === 'off')).toBe(false);
  });

  it('preserves API results, records resolved and rejected failures, and throttles success traces', async () => {
    const result = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(traceApi('group.fetch', async () => result)).resolves.toBe(result);
    await settle();
    expect(rows.some((row) => row.operation === 'error.group.fetch')).toBe(true);

    await expect(traceApi('group.reject', async () => {
      throw Object.assign(new Error('network'), { status: 503 });
    })).rejects.toThrow('network');
    await settle();
    expect(rows.some((row) => row.operation === 'error.group.reject')).toBe(true);

    jest.useFakeTimers({ now: 100_000 });
    const success = { data: { ok: true }, error: null };
    await expect(traceApi('group.success', async () => success)).resolves.toBe(success);
    await expect(traceApi('group.success', async () => success)).resolves.toBe(success);
    await jest.advanceTimersByTimeAsync(20_001);
    await expect(traceApi('group.success', async () => success)).resolves.toBe(success);
    await settle();
    expect(rows.filter((row) => row.operation === 'group.success')).toHaveLength(2);
    jest.useRealTimers();
  });

  it('starts and stops consented low-overhead energy sampling without JS FPS work', async () => {
    delete process.env.EXPO_PUBLIC_PERFORMANCE_TRACING;
    const stop = startPerformanceMonitor();
    await settle();
    expect(mockEnergy.start).toHaveBeenCalledTimes(1);
    const handler = energyHandlers[0];
    expect(handler).toBeDefined();
    handler?.(observation);
    await settle();
    expect(mockMetrics.samplePerformance).toHaveBeenCalledWith(1_000);
    const energyRow = rows.find((row) => row.operation === 'runtime.energy.sample');
    expect(energyRow).toBeDefined();
    expect(JSON.parse(energyRow!.payload)).toMatchObject({ confidence: 'energy_only' });
    stop();

    mockConsent.mockResolvedValue(false);
    const before = mockEnergy.start.mock.calls.length;
    const noStart = startPerformanceMonitor();
    await settle();
    expect(mockEnergy.start).toHaveBeenCalledTimes(before);
    noStart();
  });

  it('measures a foreground interaction and cleans the shared navigation monitor', async () => {
    jest.useFakeTimers();
    let frame = 0;
    const raf = (callback: FrameRequestCallback) => {
      frame += 1;
      return setTimeout(() => callback(Date.now()), 16) as unknown as number;
    };
    (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame = raf;
    (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame = (id) => clearTimeout(id);
    markInteraction('map.render', { count: 1 });
    markInteraction('map.render', { count: 2 });
    await jest.advanceTimersByTimeAsync(1_300);
    await settle();
    expect(frame).toBeGreaterThan(0);
    expect(mockMetrics.samplePerformance).toHaveBeenCalled();

    jest.useRealTimers();
    const stop = startNavigationEnergyMonitor({ navigationSessionId: 'session-1', trackingMode: 'teamNavigation' });
    await settle();
    expect(mockEnergy.setTrackingMode).toHaveBeenCalledWith('teamNavigation');
    const handler = energyHandlers[energyHandlers.length - 1];
    handler?.({ ...observation, kind: 'startup' });
    handler?.(observation);
    await settle();
    stop();
    await settle();
    expect(mockMetrics.samplePerformance).toHaveBeenCalled();
  });

  it('does not sample ordinary energy work in background, while allowing the end boundary', async () => {
    setPerformanceAppState('background');
    const stop = startNavigationEnergyMonitor({ navigationSessionId: null, trackingMode: 'passiveBackground' });
    await settle();
    expect(mockMetrics.samplePerformance).not.toHaveBeenCalled();
    stop();
    await settle();
    expect(mockMetrics.samplePerformance).toHaveBeenCalledTimes(1);
    setPerformanceAppState('active');
  });
});
