import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Updates from 'expo-updates';
import { metrics } from '../native';
import {
  buildErrorDiagnostics,
  classifyUpstreamError,
  MAX_FIELD_STRING,
  redactSensitiveText,
} from '../utils/errorFingerprint';
import { getDiagnosticConsentEnabled } from './diagnosticConsent';
import { getHitherDatabase } from './hitherDatabase';
import { notifyErrorRecorded, notifyLogRecorded } from './logBatchScheduler';

const TRACE_START_KEY = 'hither.performance.trace.startedAt.v1';
const TRACE_TTL_MS = 2 * 60 * 60 * 1_000;
const SUCCESS_TRACE_MIN_INTERVAL_MS = 10_000;
const LOCAL_RETENTION_MS = 72 * 60 * 60 * 1_000;
const MAX_LOCAL_RECORDS = 10_000;
const MAX_UPLOAD_BATCH = 100;
const SAMPLE_WINDOW_MS = 1_000;
const SAMPLE_INTERVAL_MS = 5 * 60_000;
const RETENTION_CLEANUP_INTERVAL_MS = 15 * 60 * 1_000;
/** Stay under performance_events 32 KB payload contract. */
const MAX_PAYLOAD_JSON_BYTES = 30_000;

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
export interface PerformanceFlushResult {
  sent: number;
  remaining: number;
}

let flushInFlight: Promise<PerformanceFlushResult> | null = null;
let writeSerial = Promise.resolve();
let activeInteraction: { id: string; operation: string } | null = null;
/** UI action context — correlated with API traces and error events. */
type ActiveActionContext = {
  actionId: string;
  screen: string;
  parentTraceId: string;
  /** Monotonic owner token so clear only drops matching generation. */
  generation: number;
};
let activeActionContext: ActiveActionContext | null = null;
let actionContextGeneration = 0;
let nativeSampleInFlight = false;
let lastRetentionCleanupAt = 0;
const lastSuccessTraceAt = new Map<string, number>();

/** Prior sample for process CPU % derivation (cpuTimeMs is cumulative). */
let lastCpuSample: { cpuTimeMs: number; wallMs: number } | null = null;
let lastMemoryMb: number | null = null;

/**
 * Derive process CPU % from two cumulative cpuTimeMs readings over wall time.
 * Not core-normalized; confidence is 'estimated'. Returns null without a prior sample.
 */
export function deriveCpuPercent(
  prev: { cpuTimeMs: number; wallMs: number } | null,
  next: { cpuTimeMs: number; wallMs: number },
): number | null {
  if (!prev) return null;
  const wallDelta = next.wallMs - prev.wallMs;
  const cpuDelta = next.cpuTimeMs - prev.cpuTimeMs;
  if (!(wallDelta > 0) || !(cpuDelta >= 0) || !Number.isFinite(cpuDelta) || !Number.isFinite(wallDelta)) {
    return null;
  }
  // Cap at 100% of one core-equivalent wall window (process may use more cores later).
  const pct = (cpuDelta / wallDelta) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(400, pct));
}

/**
 * Host (App.tsx) pushes AppState / platform here so this module stays free of
 * react-native imports (Jest node suite cannot load RN).
 */
let performanceAppState = 'active';
let performancePlatform = 'unknown';

export function setPerformanceAppState(state: string): void {
  if (typeof state === 'string' && state.length > 0) {
    performanceAppState = state;
  }
}

/** ios | android | web — host-injected; never import react-native here. */
export function setPerformancePlatform(platform: string): void {
  if (platform === 'ios' || platform === 'android' || platform === 'web') {
    performancePlatform = platform;
  }
}

export function getPerformancePlatform(): string {
  return performancePlatform;
}

function isAppForeground(): boolean {
  return performanceAppState === 'active';
}

/**
 * Allow-listed performance payload keys. Fields not listed are dropped before
 * the SQLite outbox write. Keep correlation + bounded diagnostics; never
 * group/user/coordinate/token free-form blobs.
 */
export const PERFORMANCE_SAFE_FIELDS = new Set([
  'actionId',
  'appState',
  'appVersion',
  'batteryLevel',
  'batteryState',
  'buildNumber',
  'componentStack',
  'confidence',
  'count',
  'cpuPercent',
  'cpuTimeMs',
  'deviceModel',
  'displayMaxFps',
  'durationMs',
  'errorCode',
  'errorDetails',
  'errorFrames',
  'errorHint',
  'errorMessage',
  'exceptionKind',
  'frameTimeP95Ms',
  'httpStatus',
  'isFatal',
  'jsFps',
  'launchPhase',
  'lastScreen',
  'lowPowerMode',
  'mapLoadedMissing',
  'mapMountCount',
  'mapReadyToLoadedMs',
  'memoryDeltaMb',
  'memoryMb',
  'missedFrameRatio',
  'nativeExitReason',
  'navigationSessionId',
  'operation',
  'operationSource',
  'osVersion',
  'outcome',
  'parentTraceId',
  'platform',
  'reason',
  'requestId',
  'requestSizeBucket',
  'responseCount',
  'retryCount',
  'routeKey',
  'routeName',
  'runtimeVersion',
  'sampleWindowMs',
  'screen',
  'scope',
  'source',
  'sourceLocation',
  'stackHash',
  'status',
  'subsystem',
  'supabaseCode',
  'supabaseOperation',
  'thermalState',
  'timeoutMs',
  'trackingMode',
  'uiFps',
  'updateId',
]);

/** Breadcrumbs for error context — updated from App launch phases / navigation. */
let lastLaunchPhase = 'unknown';
let lastScreenName = 'unknown';
let lastRouteName = 'unknown';
let lastRouteKey = '';

export function setLastLaunchPhase(phase: string): void {
  if (typeof phase === 'string' && phase.length > 0) {
    lastLaunchPhase = phase.slice(0, 80);
  }
}

export function setLastScreenName(screen: string): void {
  if (typeof screen === 'string' && screen.length > 0) {
    lastScreenName = screen.slice(0, 80);
  }
}

export function getLastScreenName(): string {
  return lastScreenName;
}

/** Deepest active React Navigation route (name + key for correlation). */
export function setLastRoute(routeName: string, routeKey?: string): void {
  if (typeof routeName === 'string' && routeName.length > 0) {
    lastRouteName = routeName.slice(0, 80);
    lastScreenName = lastRouteName;
  }
  if (typeof routeKey === 'string' && routeKey.length > 0) {
    // Route keys from React Navigation can embed UUIDs — keep a short stable tag.
    lastRouteKey = routeKey.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      'id',
    ).slice(0, 80);
  }
}

export function getLastRoute(): { routeName: string; routeKey: string } {
  return { routeName: lastRouteName, routeKey: lastRouteKey };
}

/**
 * Bind the current UI action so API traces and error events share parentTraceId.
 * Does not change action single-flight / timeout / retry behavior.
 * Returns a generation token — pass it to clearActiveActionContext so a concurrent
 * action cannot have its context wiped by an earlier action's finally.
 */
export function setActiveActionContext(input: {
  actionId: string;
  screen: string;
  parentTraceId?: string;
}): { generation: number; parentTraceId: string; actionId: string; screen: string } {
  // Length-bound only — do not run JWT/UUID redaction on correlation keys.
  const actionId =
    typeof input.actionId === 'string' && input.actionId.length > 0
      ? input.actionId.slice(0, 80)
      : 'unknown';
  const screen =
    typeof input.screen === 'string' && input.screen.length > 0
      ? input.screen.slice(0, 80)
      : lastScreenName;
  const parentTraceId =
    (typeof input.parentTraceId === 'string' && input.parentTraceId.length > 0
      ? input.parentTraceId.slice(0, 80)
      : activeInteraction?.id) ?? Crypto.randomUUID();
  actionContextGeneration += 1;
  const generation = actionContextGeneration;
  activeActionContext = { actionId, screen, parentTraceId, generation };
  return { generation, parentTraceId, actionId, screen };
}

/**
 * Clear action context. When `generation` is provided, only clears if this
 * generation still owns the slot (safe under concurrent different actionIds).
 */
export function clearActiveActionContext(generation?: number): void {
  if (generation != null) {
    if (activeActionContext?.generation !== generation) return;
  }
  activeActionContext = null;
}

export function getActiveActionContext(): {
  actionId: string;
  screen: string;
  parentTraceId: string;
  generation: number;
} | null {
  return activeActionContext;
}

/** Avoid importing otaUpdates (pulls react-native) so unit tests stay node-safe. */
function currentUpdateId(): string {
  try {
    if (Updates.isEmbeddedLaunch || !Updates.updateId) return 'embedded';
    return Updates.updateId;
  } catch {
    return 'embedded';
  }
}

function releaseContext(): PerformancePayload {
  return {
    buildNumber: Constants.nativeBuildVersion ?? 'development',
    appVersion: Constants.expoConfig?.version ?? 'development',
    updateId: currentUpdateId(),
    runtimeVersion: String(Updates.runtimeVersion ?? 'unknown'),
    launchPhase: lastLaunchPhase,
    lastScreen: lastScreenName,
    routeName: lastRouteName,
    routeKey: lastRouteKey || null,
    platform: performancePlatform,
  };
}

/** Correlation keys must keep their UUID/opaque values — only length-bound. */
const CORRELATION_ID_FIELDS = new Set([
  'requestId',
  'parentTraceId',
  'actionId',
  'navigationSessionId',
]);

/** Approximate UTF-8 byte length without Buffer (works in RN / Jest node). */
export function utf8ByteLength(value: string): number {
  // encodeURIComponent escapes non-ASCII as %XX sequences — 3 chars per byte.
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair → 4 UTF-8 bytes
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

function correlationContext(): PerformancePayload {
  const out: PerformancePayload = {};
  if (activeActionContext) {
    out.actionId = activeActionContext.actionId;
    out.screen = activeActionContext.screen;
    out.parentTraceId = activeActionContext.parentTraceId;
  } else if (activeInteraction) {
    out.parentTraceId = activeInteraction.id;
  }
  if (lastScreenName !== 'unknown' && out.screen == null) {
    out.screen = lastScreenName;
  }
  return out;
}

function normalizeOperation(operation: string): string {
  return operation.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'unknown';
}

function sanitizeStringValue(key: string, value: string): string {
  const max =
    key === 'errorFrames' || key === 'componentStack'
      ? 800
      : key === 'errorMessage' || key === 'errorDetails'
        ? 240
        : key === 'errorHint' || key === 'sourceLocation'
          ? 160
          : key === 'requestId' || key === 'parentTraceId'
            ? 80
            : MAX_FIELD_STRING;
  // Correlation IDs are intentionally UUID/opaque — length-bound only.
  // Full redaction would collapse every requestId/parentTraceId to one placeholder.
  if (CORRELATION_ID_FIELDS.has(key)) {
    return value.slice(0, max);
  }
  return redactSensitiveText(value).slice(0, max);
}

function payloadWithinBudget(payload: PerformancePayload): boolean {
  return utf8ByteLength(JSON.stringify(payload)) <= MAX_PAYLOAD_JSON_BYTES;
}

/**
 * Drop non-allow-listed fields, redact sensitive string content, coerce to
 * PerformanceValue. Exported for contract tests.
 */
export function sanitizePerformancePayload(
  payload: Record<string, unknown> = {},
): PerformancePayload {
  const result: PerformancePayload = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!PERFORMANCE_SAFE_FIELDS.has(key)) continue;
    if (value === null) {
      result[key] = null;
      continue;
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) result[key] = value;
      continue;
    }
    if (typeof value === 'boolean') {
      result[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      result[key] = sanitizeStringValue(key, value);
    }
    // Drop objects/arrays (coordinates, raw responses, etc.).
  }
  // Bound total JSON size under the 32 KB DB contract (UTF-8 byte estimate).
  if (payloadWithinBudget(result)) return result;
  // Prefer dropping the largest diagnostic strings first.
  for (const dropKey of [
    'errorFrames',
    'componentStack',
    'errorDetails',
    'errorHint',
    'errorMessage',
    'sourceLocation',
  ]) {
    if (dropKey in result) {
      delete result[dropKey];
      if (payloadWithinBudget(result)) return result;
    }
  }
  // Last resort: hard-truncate remaining long strings (keep correlation keys).
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string' && !CORRELATION_ID_FIELDS.has(key) && value.length > 40) {
      result[key] = value.slice(0, 40);
    }
  }
  if (payloadWithinBudget(result)) return result;
  // Extreme fallback: keep only correlation + release-critical keys.
  const essentials: PerformancePayload = {};
  for (const key of [
    'requestId',
    'parentTraceId',
    'actionId',
    'errorCode',
    'outcome',
    'subsystem',
    'routeName',
    'screen',
    'httpStatus',
    'supabaseCode',
    'supabaseOperation',
    'stackHash',
    'exceptionKind',
    'platform',
  ]) {
    if (key in result) essentials[key] = result[key]!;
  }
  return essentials;
}

/** @deprecated internal alias — prefer sanitizePerformancePayload. */
function sanitizePayload(payload: Record<string, unknown> = {}): PerformancePayload {
  return sanitizePerformancePayload(payload);
}

function errorCode(error: unknown): string {
  const classified = classifyUpstreamError(error);
  if (classified.errorCode !== 'unclassified_error') return classified.errorCode;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code.slice(0, 80);
  }
  return 'unclassified_error';
}

/** True when a resolved Supabase-style result carries a non-null error. */
export function isSupabaseErrorResult(
  result: unknown,
): result is { error: { message?: string; code?: string; details?: string; hint?: string } } {
  if (typeof result !== 'object' || result === null) return false;
  if (!('error' in result)) return false;
  const err = (result as { error: unknown }).error;
  return typeof err === 'object' && err !== null;
}

function extractHttpStatus(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && Number.isFinite(status)) return status;
  }
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && Number.isFinite(status)) return status;
  }
  return classifyUpstreamError(error).httpStatus;
}

function shouldRecordSuccess(operation: string, now: number): boolean {
  const last = lastSuccessTraceAt.get(operation) ?? 0;
  if (now - last < SUCCESS_TRACE_MIN_INTERVAL_MS) return false;
  lastSuccessTraceAt.set(operation, now);
  return true;
}

async function cleanupRetention(
  database: Awaited<ReturnType<typeof getHitherDatabase>>,
): Promise<void> {
  await database.runAsync(
    'DELETE FROM performance_events WHERE timestamp < ?',
    Date.now() - LOCAL_RETENTION_MS,
  );
  // Prefer keeping errors: drop oldest sample/trace first when over cap.
  await database.runAsync(
    `DELETE FROM performance_events
     WHERE id IN (
       SELECT id FROM performance_events
       ORDER BY
         CASE event_type WHEN 'error' THEN 1 ELSE 0 END DESC,
         timestamp DESC
       LIMIT -1 OFFSET ?
     )`,
    MAX_LOCAL_RECORDS,
  );
  lastRetentionCleanupAt = Date.now();
}

async function maybeCleanupRetention(
  database: Awaited<ReturnType<typeof getHitherDatabase>>,
): Promise<void> {
  if (Date.now() - lastRetentionCleanupAt < RETENTION_CLEANUP_INTERVAL_MS) return;
  await cleanupRetention(database);
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
      if (active) {
        const database = await getHitherDatabase();
        await cleanupRetention(database).catch(() => undefined);
      }
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
    if (!(await getDiagnosticConsentEnabled())) return;
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
    await maybeCleanupRetention(database);
    if (event.eventType === 'error') {
      notifyErrorRecorded();
    } else {
      notifyLogRecorded();
    }
  });
  writeSerial = next.then(() => undefined, () => undefined);
  return next;
}

export async function purgePerformance(): Promise<void> {
  const database = await getHitherDatabase();
  await database.runAsync(
    'DELETE FROM performance_events WHERE uploaded_at IS NULL',
  );
}

async function getPending(limit = MAX_UPLOAD_BATCH): Promise<PerformanceUploadRecord[]> {
  const database = await getHitherDatabase();
  const rows = await database.getAllAsync<PerformanceRow>(
    `SELECT * FROM performance_events
     WHERE uploaded_at IS NULL
     ORDER BY CASE event_type WHEN 'error' THEN 0 ELSE 1 END, timestamp ASC
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
  if (!(await getDiagnosticConsentEnabled())) {
    return { sent: 0, remaining: 0 };
  }
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

async function record(
  eventType: PerformanceUploadRecord['eventType'],
  operation: string,
  payload: Record<string, unknown>,
  id = Crypto.randomUUID(),
): Promise<void> {
  // Full sample/trace only while the 2h full-tracing window is active.
  if (eventType !== 'error' && !active) return;
  if (!(await getDiagnosticConsentEnabled())) return;
  await insertEvent({
    id,
    timestamp: Date.now(),
    sessionId,
    eventType,
    operation: normalizeOperation(operation),
    payload: {
      ...sanitizePayload({
        ...correlationContext(),
        ...payload,
      }),
      ...releaseContext(),
    },
  });
}

/**
 * Minimal error telemetry — independent of EXPO_PUBLIC_PERFORMANCE_TRACING=full
 * and the 2-hour full-trace TTL. Still consent-gated; same SQLite outbox.
 */
export async function recordErrorEvent(
  operation: string,
  payload: Record<string, unknown> = {},
  id = Crypto.randomUUID(),
): Promise<void> {
  if (!(await getDiagnosticConsentEnabled())) return;
  await insertEvent({
    id,
    timestamp: Date.now(),
    sessionId,
    eventType: 'error',
    operation: normalizeOperation(operation),
    payload: {
      ...sanitizePayload({
        ...correlationContext(),
        ...payload,
      }),
      ...releaseContext(),
    },
  });
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

function enrichNativeSample(
  nativeSample: Record<string, unknown> | null,
): Record<string, unknown> {
  const wallMs = Date.now();
  const out: Record<string, unknown> = { ...(nativeSample ?? {}) };
  const cpuTimeMs =
    typeof nativeSample?.cpuTimeMs === 'number' && Number.isFinite(nativeSample.cpuTimeMs)
      ? nativeSample.cpuTimeMs
      : null;
  if (cpuTimeMs != null) {
    const derived = deriveCpuPercent(lastCpuSample, { cpuTimeMs, wallMs });
    lastCpuSample = { cpuTimeMs, wallMs };
    if (derived != null && (out.cpuPercent == null || out.cpuPercent === null)) {
      out.cpuPercent = derived;
      out.confidence = 'estimated';
    }
  }
  const memoryMb =
    typeof nativeSample?.memoryMb === 'number' && Number.isFinite(nativeSample.memoryMb)
      ? nativeSample.memoryMb
      : null;
  if (memoryMb != null) {
    if (lastMemoryMb != null) {
      out.memoryDeltaMb = memoryMb - lastMemoryMb;
    }
    lastMemoryMb = memoryMb;
  }
  return out;
}

async function collectSample(
  eventType: 'sample' | 'trace',
  operation: string,
  traceId?: string,
): Promise<void> {
  if (!active || nativeSampleInFlight) return;
  // Background: skip JS FPS rAF + non-essential samples to cut CPU.
  if (!isAppForeground() && eventType === 'sample') return;
  if (!(await getDiagnosticConsentEnabled())) return;
  nativeSampleInFlight = true;
  try {
    const measureFps = isAppForeground();
    const [nativeSample, jsFps] = await Promise.all([
      metrics.samplePerformance(SAMPLE_WINDOW_MS).catch(() => null),
      measureFps ? measureJsFps(SAMPLE_WINDOW_MS) : Promise.resolve(null),
    ]);
    if (!nativeSample && jsFps == null) return;
    const enriched = enrichNativeSample(
      nativeSample ? (nativeSample as unknown as Record<string, unknown>) : null,
    );
    await record(eventType, operation, {
      ...enriched,
      jsFps,
      parentTraceId: traceId ?? null,
      confidence:
        typeof enriched.confidence === 'string'
          ? enriched.confidence
          : eventType === 'trace'
            ? 'shared'
            : 'background',
      appState: performanceAppState,
    });
  } finally {
    nativeSampleInFlight = false;
  }
}

async function collectEnergySample(
  operation: string,
  context: {
    navigationSessionId: string | null;
    trackingMode: string;
  },
): Promise<void> {
  if (nativeSampleInFlight) return;
  // Energy end sample always allowed; mid-session samples only in foreground.
  if (!isAppForeground() && !operation.endsWith('.end')) return;
  if (!(await getDiagnosticConsentEnabled())) return;
  nativeSampleInFlight = true;
  try {
    const nativeSample = await metrics.samplePerformance(SAMPLE_WINDOW_MS).catch(() => null);
    if (!nativeSample) return;
    const enriched = enrichNativeSample(nativeSample as unknown as Record<string, unknown>);
    await insertEvent({
      id: Crypto.randomUUID(),
      timestamp: Date.now(),
      sessionId,
      eventType: 'sample',
      operation: normalizeOperation(operation),
      payload: {
        ...sanitizePayload({
          ...enriched,
          navigationSessionId: context.navigationSessionId,
          trackingMode: context.trackingMode,
          sampleWindowMs: SAMPLE_WINDOW_MS,
          confidence:
            typeof enriched.confidence === 'string' ? enriched.confidence : 'background',
          appState: performanceAppState,
        }),
        ...releaseContext(),
      },
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
  const isFatal = extra?.isFatal === true;
  let base = operation.replace(/^error\./, '');
  if (base === 'unhandled_exception') {
    base = isFatal ? 'js_fatal' : 'js_unhandled';
  }
  const op = base.startsWith('error.')
    ? normalizeOperation(base)
    : `error.${normalizeOperation(base)}`;
  const diagnostics = buildErrorDiagnostics(error, extra?.componentStack);
  const classified = classifyUpstreamError(error);
  const httpStatus =
    typeof extra?.httpStatus === 'number'
      ? (extra.httpStatus as number)
      : extractHttpStatus(error);
  await recordErrorEvent(op, {
    ...extra,
    ...diagnostics,
    errorCode:
      typeof extra?.errorCode === 'string'
        ? extra.errorCode
        : errorCode(error),
    subsystem:
      typeof extra?.subsystem === 'string'
        ? extra.subsystem
        : classified.subsystem,
    httpStatus,
    isFatal,
    outcome: 'failed',
    parentTraceId:
      (typeof extra?.parentTraceId === 'string' ? extra.parentTraceId : null)
      ?? activeActionContext?.parentTraceId
      ?? activeInteraction?.id
      ?? null,
    actionId: extra?.actionId ?? activeActionContext?.actionId ?? null,
    screen: extra?.screen ?? activeActionContext?.screen ?? lastScreenName,
    routeName: lastRouteName,
    routeKey: lastRouteKey || null,
  });
}

/**
 * Record a classified upstream failure (Maps, Live Activity, auth) without
 * changing the caller's throw/fallback behavior.
 */
export async function recordClassifiedError(
  operation: string,
  error: unknown,
  extra?: Record<string, unknown>,
): Promise<void> {
  await recordPerformanceError(operation, error, extra);
}

type TraceApiErrorPayload = {
  durationMs: number;
  errorCode: string;
  outcome: 'failed';
  parentTraceId: string | null;
  supabaseOperation: string;
  supabaseCode: string | null;
  httpStatus: number | null;
  errorMessage: string | null;
  errorDetails: string | null;
  errorHint: string | null;
  subsystem: string;
  actionId: string | null;
  screen: string | null;
  routeName: string;
  requestId: string;
};

function buildApiErrorPayload(
  operation: string,
  error: unknown,
  startedAt: number,
  captured: {
    parentTraceId: string | null;
    requestId: string;
    actionId: string | null;
    screen: string | null;
    routeName: string;
  },
): TraceApiErrorPayload {
  const diagnostics = buildErrorDiagnostics(error);
  const classified = classifyUpstreamError(error);
  return {
    durationMs: Date.now() - startedAt,
    errorCode: errorCode(error),
    outcome: 'failed',
    parentTraceId: captured.parentTraceId,
    supabaseOperation: operation,
    supabaseCode:
      typeof (error as { code?: unknown })?.code === 'string'
        ? String((error as { code: string }).code).slice(0, 80)
        : null,
    httpStatus: extractHttpStatus(error),
    errorMessage: diagnostics.errorMessage,
    errorDetails: diagnostics.errorDetails,
    errorHint: diagnostics.errorHint,
    subsystem: classified.subsystem,
    // Captured at trace start — not live global (concurrent actions safe).
    actionId: captured.actionId,
    screen: captured.screen,
    routeName: captured.routeName,
    requestId: captured.requestId,
  };
}

/**
 * Trace a Supabase/API call. Records success spans only while full tracing is
 * active; always records error events (rejected promise OR resolved `{ error }`)
 * when consent is on — independent of the 2h full-trace window.
 * Preserves the original result / rethrow behavior.
 *
 * Canonical error owner for instrumented Supabase `from`/`rpc` paths — call sites
 * should soft-fail without a second recordClassifiedError/logError for the same failure.
 */
export async function traceApi<T>(operation: string, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  // Snapshot correlation at start so concurrent UI actions cannot rewrite it.
  const captured = {
    parentTraceId:
      activeActionContext?.parentTraceId ?? activeInteraction?.id ?? null,
    requestId: Crypto.randomUUID(),
    actionId: activeActionContext?.actionId ?? null,
    screen: activeActionContext?.screen ?? lastScreenName,
    routeName: lastRouteName,
  };

  const recordFailure = (error: unknown) => {
    void recordErrorEvent(
      operation.startsWith('error.') ? operation : `error.${normalizeOperation(operation)}`,
      buildApiErrorPayload(operation, error, startedAt, captured),
    );
  };

  try {
    const result = await work();
    if (isSupabaseErrorResult(result)) {
      recordFailure(result.error);
      return result;
    }
    if (active) {
      const now = Date.now();
      if (shouldRecordSuccess(operation, now)) {
        void record('trace', operation, {
          durationMs: now - startedAt,
          outcome: 'succeeded',
          parentTraceId: captured.parentTraceId,
          requestId: captured.requestId,
          supabaseOperation: operation,
          actionId: captured.actionId,
          screen: captured.screen,
          routeName: captured.routeName,
        });
      }
    }
    return result;
  } catch (error) {
    recordFailure(error);
    throw error;
  }
}

export function startPerformanceMonitor(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  void ensureEnabled().then(async (enabled) => {
    if (!enabled || stopped) return;
    if (!(await getDiagnosticConsentEnabled())) return;
    if (isAppForeground()) {
      await collectSample('sample', 'runtime.sample');
    }
    if (!stopped) {
      timer = setInterval(() => {
        // Host updates setPerformanceAppState from AppState; skip when background.
        if (!isAppForeground()) return;
        void collectSample('sample', 'runtime.sample');
      }, SAMPLE_INTERVAL_MS);
    }
  });
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}

/**
 * Low-overhead energy trend while navigation is active.
 * Works without EXPO_PUBLIC_PERFORMANCE_TRACING=full; no per-API traces or JS FPS.
 */
export function startNavigationEnergyMonitor(context: {
  navigationSessionId: string | null;
  trackingMode: string;
}): () => void {
  let stopped = false;
  const sample = () => {
    if (stopped || nativeSampleInFlight) return;
    void collectEnergySample('navigation.energy.sample', context);
  };
  sample();
  const timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
    void collectEnergySample('navigation.energy.end', context);
  };
}
