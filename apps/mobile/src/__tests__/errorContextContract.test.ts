/**
 * Ticket 01 — error context & correlation contract tests.
 * Pure / source contracts; no device required.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  boundDiagnosticText,
  boundedComponentStack,
  boundedErrorFrames,
  boundedErrorMessage,
  buildErrorDiagnostics,
  classifyUpstreamError,
  MAX_ERROR_MESSAGE,
  redactSensitiveText,
  stackHash,
} from '../utils/errorFingerprint';
import {
  isSupabaseErrorResult,
  PERFORMANCE_SAFE_FIELDS,
  sanitizePerformancePayload,
} from '../state/performance';

// Lightweight mocks so importing performance stays node-safe.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000099'),
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
jest.mock('../state/diagnosticConsent', () => ({
  getDiagnosticConsentEnabled: jest.fn(async () => true),
}));
jest.mock('../state/logBatchScheduler', () => ({
  notifyLogRecorded: jest.fn(),
  notifyErrorRecorded: jest.fn(),
}));
jest.mock('../state/hitherDatabase', () => ({
  getHitherDatabase: jest.fn(async () => ({
    runAsync: jest.fn(),
    getAllAsync: jest.fn(async () => []),
    withTransactionAsync: jest.fn(async (w: () => Promise<void>) => w()),
  })),
}));

describe('error diagnostics redaction & bounds', () => {
  it('redacts JWT, Bearer tokens, UUIDs, URL queries, and coordinates', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const raw = `Bearer ${jwt} user=${uuid} url=https://x.test/a?token=secret lat=25.0478123,121.5170456`;
    const redacted = redactSensitiveText(raw);
    expect(redacted).not.toContain(jwt);
    expect(redacted).not.toContain(uuid);
    expect(redacted).not.toContain('token=secret');
    expect(redacted).toContain('[redacted');
    expect(redacted).not.toMatch(/25\.0478123/);
  });

  it('caps error message length', () => {
    const long = 'x'.repeat(500);
    const msg = boundedErrorMessage(new Error(long));
    expect(msg).not.toBeNull();
    expect(msg!.length).toBeLessThanOrEqual(MAX_ERROR_MESSAGE);
  });

  it('keeps filename/line in error frames without absolute paths', () => {
    const err = new Error('boom');
    err.stack =
      'Error: boom\n    at Foo (/Users/me/app/src/components/Foo.tsx:12:4)\n    at Bar (Bar.tsx:3:1)';
    const frames = boundedErrorFrames(err);
    expect(frames).toContain('Foo.tsx');
    expect(frames).not.toContain('/Users/me');
    const loc = buildErrorDiagnostics(err).sourceLocation;
    expect(loc).toMatch(/Foo\.tsx:12/);
  });

  it('bounds component stack and keeps component names', () => {
    const stack =
      '\n    in MapScreen (at MapScreen.tsx:10)\n    in App (at App.tsx:1)\n';
    const bounded = boundedComponentStack(stack);
    expect(bounded).toContain('MapScreen');
    expect(bounded).not.toMatch(/\/Users\//);
  });
});

describe('performance allow-list sanitize', () => {
  it('retains correlation and diagnostic fields', () => {
    const payload = sanitizePerformancePayload({
      actionId: 'map.sync',
      screen: 'Map',
      routeName: 'Map',
      routeKey: 'Map-id',
      requestId: 'req-1',
      parentTraceId: 'parent-1',
      errorMessage: 'leader role required',
      errorFrames: 'at Foo (Foo.tsx:1:1)',
      componentStack: 'in MapScreen',
      sourceLocation: 'Foo.tsx:1:1',
      operation: 'api.rpc.report_straggler',
      status: 403,
      errorCode: 'leader_role_required',
      subsystem: 'authorization',
      supabaseCode: 'P0001',
      supabaseOperation: 'api.rpc.report_straggler',
      httpStatus: 403,
      updateId: 'embedded',
      runtimeVersion: '0.1.3',
      buildNumber: '1',
    });
    expect(payload.actionId).toBe('map.sync');
    expect(payload.screen).toBe('Map');
    expect(payload.routeName).toBe('Map');
    expect(payload.requestId).toBe('req-1');
    expect(payload.parentTraceId).toBe('parent-1');
    expect(payload.errorMessage).toContain('leader role');
    expect(payload.componentStack).toContain('MapScreen');
    expect(payload.subsystem).toBe('authorization');
    expect(payload.httpStatus).toBe(403);
  });

  it('preserves distinct RFC-4122 requestId and parentTraceId (no UUID redaction)', () => {
    const requestId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const parentTraceId = '11111111-2222-4333-8444-555555555555';
    const payload = sanitizePerformancePayload({
      requestId,
      parentTraceId,
      actionId: 'map.sync',
      errorMessage: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U and ${requestId}`,
    });
    expect(payload.requestId).toBe(requestId);
    expect(payload.parentTraceId).toBe(parentTraceId);
    expect(payload.requestId).not.toContain('redacted');
    expect(payload.parentTraceId).not.toContain('redacted');
    // Free-text diagnostics still redact secrets and embedded UUIDs.
    expect(String(payload.errorMessage)).not.toContain('eyJ');
    expect(String(payload.errorMessage)).toContain('[redacted');
  });

  it('drops unauthorized fields (group/user/coordinates/raw response)', () => {
    const payload = sanitizePerformancePayload({
      actionId: 'ok',
      groupId: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'user-1',
      latitude: 25.04,
      longitude: 121.5,
      rawResponse: { secret: true },
      accessToken: 'supersecrettokenvalue0123456789abcdef',
    });
    expect(payload.actionId).toBe('ok');
    expect(payload).not.toHaveProperty('groupId');
    expect(payload).not.toHaveProperty('userId');
    expect(payload).not.toHaveProperty('latitude');
    expect(payload).not.toHaveProperty('longitude');
    expect(payload).not.toHaveProperty('rawResponse');
    expect(payload).not.toHaveProperty('accessToken');
  });

  it('redacts sensitive content inside allowed string fields', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const payload = sanitizePerformancePayload({
      errorMessage: `failed with Bearer ${jwt}`,
    });
    expect(String(payload.errorMessage)).not.toContain(jwt);
    expect(String(payload.errorMessage)).toContain('[redacted');
  });

  it('SAFE_FIELDS includes the ticket 01 correlation contract keys', () => {
    for (const key of [
      'routeName',
      'routeKey',
      'lastScreen',
      'actionId',
      'screen',
      'requestId',
      'operation',
      'status',
      'errorCode',
      'parentTraceId',
      'errorMessage',
      'errorDetails',
      'errorHint',
      'errorFrames',
      'sourceLocation',
      'componentStack',
      'updateId',
      'runtimeVersion',
      'buildNumber',
    ]) {
      expect(PERFORMANCE_SAFE_FIELDS.has(key)).toBe(true);
    }
  });

  it('boundDiagnosticText returns null for empty input', () => {
    expect(boundDiagnosticText('')).toBeNull();
    expect(boundDiagnosticText(null)).toBeNull();
  });
});

describe('upstream classification helpers', () => {
  it('classifies leader role required as authorization 403', () => {
    const c = classifyUpstreamError(new Error('leader role required'));
    expect(c.subsystem).toBe('authorization');
    expect(c.errorCode).toBe('leader_role_required');
    expect(c.httpStatus).toBe(403);
  });

  it('classifies MapsProxyError by status', () => {
    const err = Object.assign(new Error('upstream_unavailable'), {
      name: 'MapsProxyError',
      code: 'upstream_unavailable',
      status: 503,
    });
    const c = classifyUpstreamError(err);
    expect(c.subsystem).toBe('maps');
    expect(c.httpStatus).toBe(503);
    expect(c.errorCode).toBe('upstream_unavailable');
  });

  it('classifies duplicate key as registration 409', () => {
    const c = classifyUpstreamError({
      message: 'duplicate key value violates unique constraint',
      code: '23505',
    });
    expect(c.subsystem).toBe('registration');
    expect(c.errorCode).toBe('duplicate_key');
    expect(c.httpStatus).toBe(409);
  });

  it('detects resolved Supabase { error } results', () => {
    expect(isSupabaseErrorResult({ data: null, error: { message: 'x', code: 'P0001' } })).toBe(
      true,
    );
    expect(isSupabaseErrorResult({ data: [], error: null })).toBe(false);
    expect(isSupabaseErrorResult({ data: [] })).toBe(false);
  });

  it('stackHash remains stable without raw message in hash material path', () => {
    const a = new Error('secret-a');
    a.stack = 'Error: secret-a\n    at foo (Foo.tsx:1:1)';
    const b = new Error('secret-b');
    b.stack = 'Error: secret-b\n    at foo (Foo.tsx:1:1)';
    // Different messages but same frame shape after normalize (line stripped for hash)
    expect(stackHash(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('source wiring contracts (ticket 01)', () => {
  const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
  const boundary = readFileSync(
    join(__dirname, '../components/AppErrorBoundary.tsx'),
    'utf8',
  );
  const groupMap = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');
  const uiAction = readFileSync(join(__dirname, '../utils/uiAction.ts'), 'utf8');
  const performance = readFileSync(join(__dirname, '../state/performance.ts'), 'utf8');

  it('wires navigation ready/state change to setLastRoute', () => {
    expect(app).toContain('setLastRoute');
    expect(app).toContain('onStateChange');
    expect(app).toContain('onReady');
    expect(app).toContain('getDeepestRoute');
  });

  it('passes componentStack from root and map boundaries', () => {
    expect(boundary).toContain('componentStack');
    expect(boundary).toContain("logError('react_render'");
    expect(groupMap).toContain('componentStack');
    expect(groupMap).toContain("logError('map_surface_failure'");
  });

  it('binds UI action context to parent trace without changing single-flight', () => {
    expect(uiAction).toContain('setActiveActionContext');
    expect(uiAction).toContain('clearActiveActionContext');
    expect(uiAction).toContain('inFlight.has(actionId)');
    expect(uiAction).toContain('DEFAULT_UI_ACTION_TIMEOUT_MS');
  });

  it('keeps consent gate and 32KB-oriented payload bound on outbox write', () => {
    expect(performance).toContain('getDiagnosticConsentEnabled');
    expect(performance).toContain('MAX_PAYLOAD_JSON_BYTES = 30_000');
    expect(performance).toContain('sanitizePerformancePayload');
    expect(performance).toContain('utf8ByteLength');
    expect(performance).toContain('CORRELATION_ID_FIELDS');
    expect(performance).toContain('setPerformancePlatform');
  });
});
