import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { metrics } from '../native';
import { getHitherDatabase } from './hitherDatabase';

const TRACE_START_KEY = 'hither.performance.trace.startedAt.v1';
const TRACE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const LOCAL_RETENTION_MS = 72 * 60 * 60 * 1_000;
const MAX_LOCAL_RECORDS = 10_000;
const MAX_UPLOAD_BATCH = 100;
const SAMPLE_WINDOW_MS = 5_000;

export type PerformanceValue = string | number | boolean | null;
export type PerformancePayload = Record<string, PerformanceValue>;

export interface PerformanceUploadRecord {
  id: string;
  timestamp: number;
  sessionId: string;
  eventType: 'sample' | 'trace' | 'error';
  operation: string;
  payload: PerformancePayload;
}

export type PerformanceUploader = (
  records: PerformanceUploadRecord[],
) => Promise<string[]>;

interface PerformanceRow {
  id: string;
  timestamp: number;
  session_id: string;
  event_type: PerformanceUploadRecord['eventType'];
  operation: string;
  payload: string;
  attempts: number;
  uploaded_at: number | null;
}

const sessionId = Crypto.randomUUID();
let active = false;
let initialization: Promise<boolean> | null = null;
let uploader: PerformanceUploader | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
export interface PerformanceFlushResult {
  sent: number;
  remaining: number;
}

let flushInFlight: Promise<PerformanceFlushResult> | null = null;
let writeSerial = Promise.resolve();
let activeInteraction: { id: string; operation: string } | null = null;
let nativeSampleInFlight = false;

const SAFE_FIELDS = new Set([
  'appState',
  'appVersion',
  'batteryLevel',
  'batteryState',
  'buildNumber',
  'confidence',
  'count',
  'cpuPercent',
  'cpuTimeMs',
  'deviceModel',
  'displayMaxFps',
  'durationMs',
  'errorCode',
  'frameTimeP95Ms',
  'isFatal',
  'jsFps',
  'lowPowerMode',
  'memoryDeltaMb',
  'memoryMb',
  'missedFrameRatio',
  'operationSource',
  'osVersion',
  'outcome',
  'parentTraceId',
  'requestSizeBucket',
  'responseCount',
  'sampleWindowMs',
  'source',
  'thermalState',
  'uiFps',
]);

function normalizeOperation(operation: string): string {
  return operation.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'unknown';
}

function sanitizePayload(payload: Record<string, unknown> = {}): PerformancePayload {
  const result: PerformancePayload = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!SAFE_FIELDS.has(key)) continue;
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) result[key] = value;
  }
  return result;
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code.slice(0, 80);
  }
  return 'unclassified_error';
}

async function ensureEnabled(): Promise<boolean> {
  if (process.env.EXPO_PUBLIC_PERFORMANCE_TRACING !== 'full') return false;
  if (!initialization) {
    initialization = (async () => {
      const raw = await AsyncStorage.getItem(TRACE_START_KEY);
      const startedAt = raw ? Number(raw) : Date.now();
      const validStartedAt = Number.isFinite(startedAt) ? startedAt : Date.now();
      if (!raw || !Number.isFinite(startedAt)) {
        await AsyncStorage.setItem(TRACE_START_KEY, String(validStartedAt));
      }
      active = Date.now() - validStartedAt < TRACE_TTL_MS;
      return active;
    })().catch(() => false);
  }
  return initialization;
}

export function isPerformanceTracingActive(): boolean {
  return active;
}

export function configurePerformanceTracing(nextUploader: PerformanceUploader): void {
  uploader = nextUploader;
  void ensureEnabled();
}

function insertEvent(event: PerformanceUploadRecord): Promise<void> {
  const next = writeSerial.then(async () => {
    const database = await getHitherDatabase();
    await database.runAsync(
      `INSERT OR IGNORE INTO performance_events
       (id, timestamp, session_id, event_type, operation, payload, attempts, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      event.id,
      event.timestamp,
      event.sessionId,
      event.eventType,
      event.operation,
      JSON.stringify(event.payload),
      0,
      null,
    );
    await database.runAsync(
      'DELETE FROM performance_events WHERE timestamp < ?',
      Date.now() - LOCAL_RETENTION_MS,
    );
    await database.runAsync(
      `DELETE FROM performance_events
       WHERE id IN (
         SELECT id FROM performance_events
         ORDER BY timestamp DESC
         LIMIT -1 OFFSET ?
       )`,
      MAX_LOCAL_RECORDS,
    );
  });
  writeSerial = next.then(() => undefined, () => undefined);
  return next;
}

async function getPending(limit = MAX_UPLOAD_BATCH): Promise<PerformanceUploadRecord[]> {
  const database = await getHitherDatabase();
  const rows = await database.getAllAsync<PerformanceRow>(
    `SELECT * FROM performance_events
     WHERE uploaded_at IS NULL
     ORDER BY timestamp ASC
     LIMIT ?`,
    limit,
  );
  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    sessionId: row.session_id,
    eventType: row.event_type,
    operation: row.operation,
    payload: JSON.parse(row.payload) as PerformancePayload,
  }));
}

async function resolveUpload(
  acceptedIds: string[],
  failedIds: string[],
): Promise<void> {
  const database = await getHitherDatabase();
  await database.withTransactionAsync(async () => {
    for (const id of acceptedIds) {
      await database.runAsync(
        'UPDATE performance_events SET uploaded_at = ? WHERE id = ?',
        Date.now(),
        id,
      );
    }
    for (const id of failedIds) {
      await database.runAsync(
        'UPDATE performance_events SET attempts = attempts + 1 WHERE id = ?',
        id,
      );
    }
  });
}

async function countPending(): Promise<number> {
  const database = await getHitherDatabase();
  const rows = await database.getAllAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM performance_events WHERE uploaded_at IS NULL',
  );
  const raw = rows[0]?.count;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

export async function flushPerformance(): Promise<PerformanceFlushResult> {
  if (flushInFlight) {
    return flushInFlight;
  }
  if (!uploader) {
    return { sent: 0, remaining: await countPending().catch(() => 0) };
  }
  flushInFlight = (async (): Promise<PerformanceFlushResult> => {
    const pending = await getPending();
    if (pending.length === 0) {
      return { sent: 0, remaining: 0 };
    }
    let acceptedIds: string[] = [];
    try {
      acceptedIds = await uploader!(pending);
    } catch {
      acceptedIds = [];
    }
    const pendingIds = new Set(pending.map((record) => record.id));
    const accepted = acceptedIds.filter((id) => pendingIds.has(id));
    const acceptedSet = new Set(accepted);
    const failed = pending
      .filter((record) => !acceptedSet.has(record.id))
      .map((record) => record.id);
    await resolveUpload(accepted, failed);
    return {
      sent: accepted.length,
      remaining: await countPending(),
    };
  })().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

function scheduleFlush(): void {
  if (!uploader || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPerformance();
  }, 5_000);
}

async function record(
  eventType: PerformanceUploadRecord['eventType'],
  operation: string,
  payload: Record<string, unknown>,
  id = Crypto.randomUUID(),
): Promise<void> {
  if (!active) return;
  await insertEvent({
    id,
    timestamp: Date.now(),
    sessionId,
    eventType,
    operation: normalizeOperation(operation),
    payload: {
      ...sanitizePayload(payload),
      buildNumber: Constants.nativeBuildVersion ?? 'development',
      appVersion: Constants.expoConfig?.version ?? 'development',
    },
  });
  scheduleFlush();
}

async function measureJsFps(windowMs: number): Promise<number | null> {
  const requestFrame = globalThis.requestAnimationFrame;
  const cancelFrame = globalThis.cancelAnimationFrame;
  if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') return null;
  return await new Promise<number>((resolve) => {
    const startedAt = Date.now();
    let frames = 0;
    let frameId = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelFrame(frameId);
      resolve((frames / Math.max(Date.now() - startedAt, 1)) * 1_000);
    };
    const tick = () => {
      frames += 1;
      if (Date.now() - startedAt >= windowMs) finish();
      else frameId = requestFrame(tick);
    };
    frameId = requestFrame(tick);
    setTimeout(finish, windowMs + 250);
  });
}

async function collectSample(
  eventType: 'sample' | 'trace',
  operation: string,
  traceId?: string,
): Promise<void> {
  if (!active || nativeSampleInFlight) return;
  nativeSampleInFlight = true;
  try {
    const [nativeSample, jsFps] = await Promise.all([
      metrics.samplePerformance(SAMPLE_WINDOW_MS).catch(() => null),
      measureJsFps(SAMPLE_WINDOW_MS),
    ]);
    await record(eventType, operation, {
      ...(nativeSample ?? {}),
      jsFps,
      parentTraceId: traceId ?? null,
      confidence: eventType === 'trace' ? 'shared' : 'background',
    });
  } finally {
    nativeSampleInFlight = false;
  }
}

export function markInteraction(operation: string, payload?: Record<string, unknown>): void {
  if (!active) return;
  const normalized = `ui.${normalizeOperation(operation)}`;
  if (activeInteraction?.operation === normalized) return;
  const id = Crypto.randomUUID();
  activeInteraction = { id, operation: normalized };
  void record('trace', normalized, {
    ...payload,
    confidence: 'shared',
  }, id);
  void collectSample('trace', normalized, id);
  setTimeout(() => {
    if (activeInteraction?.id === id) activeInteraction = null;
  }, SAMPLE_WINDOW_MS + 500);
}

export async function recordPerformanceError(
  operation: string,
  error: unknown,
  extra?: Record<string, unknown>,
): Promise<void> {
  await record('error', `error.${operation}`, {
    ...extra,
    errorCode: errorCode(error),
    outcome: 'failed',
    parentTraceId: activeInteraction?.id ?? null,
  });
}

export async function traceApi<T>(operation: string, work: () => Promise<T>): Promise<T> {
  if (!active) return work();
  const startedAt = Date.now();
  const parentTraceId = activeInteraction?.id ?? null;
  try {
    const result = await work();
    void record('trace', operation, {
      durationMs: Date.now() - startedAt,
      outcome: 'succeeded',
      parentTraceId,
    });
    return result;
  } catch (error) {
    void record('error', operation, {
      durationMs: Date.now() - startedAt,
      errorCode: errorCode(error),
      outcome: 'failed',
      parentTraceId,
    });
    throw error;
  }
}

export function startPerformanceMonitor(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  void ensureEnabled().then(async (enabled) => {
    if (!enabled || stopped) return;
    await collectSample('sample', 'runtime.sample');
    if (!stopped) {
      timer = setInterval(() => {
        void collectSample('sample', 'runtime.sample');
      }, 60_000);
    }
  });
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    void flushPerformance();
  };
}
