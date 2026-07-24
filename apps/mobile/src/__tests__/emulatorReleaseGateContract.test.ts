/**
 * Ticket 04 — automated portion of the release-like emulator gate.
 * Proves shared field/classification contracts exist; manual emulator steps
 * live in docs under the tickets folder.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
}));
jest.mock('expo-constants', () => ({
  nativeBuildVersion: '1',
  expoConfig: { version: '1.0.0' },
}));
jest.mock('expo-updates', () => ({
  isEmbeddedLaunch: true,
  updateId: null,
  runtimeVersion: '0.1.3',
}));
jest.mock('../native', () => ({ metrics: { samplePerformance: jest.fn() } }));
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

import { PERFORMANCE_SAFE_FIELDS } from '../state/performance';
import { classifyUpstreamError } from '../utils/errorFingerprint';

const docsDir = join(
  __dirname,
  '../../../../docs/superpowers/tickets/2026-07-24-ios-android-unexpected-error',
);

describe('emulator release gate artifacts', () => {
  it('ships local runbook and results template (no external tracker)', () => {
    expect(existsSync(join(docsDir, '04-emulator-release-gate.md'))).toBe(true);
    expect(existsSync(join(docsDir, '04-results-template.md'))).toBe(true);
    const runbook = readFileSync(join(docsDir, '04-emulator-release-gate.md'), 'utf8');
    expect(runbook).toContain('re-entry');
    expect(runbook).toContain('consent');
    expect(runbook).toContain('leader_role_required');
    expect(runbook).not.toMatch(/create.*GitHub issue/i);
  });

  it('shares aggregatable error fields for iOS and Android', () => {
    for (const key of [
      'updateId',
      'runtimeVersion',
      'routeName',
      'actionId',
      'operation',
      'errorCode',
      'httpStatus',
      'subsystem',
      'componentStack',
      'errorMessage',
      'parentTraceId',
    ]) {
      expect(PERFORMANCE_SAFE_FIELDS.has(key)).toBe(true);
    }
  });

  it('classifies offline/maps/auth/token into subsystems (not generic only)', () => {
    expect(classifyUpstreamError(new Error('Network request failed')).subsystem).toBe(
      'network',
    );
    expect(
      classifyUpstreamError({
        name: 'MapsProxyError',
        code: 'upstream_unavailable',
        status: 503,
        message: 'x',
      }).subsystem,
    ).toBe('maps');
    expect(classifyUpstreamError(new Error('leader role required')).subsystem).toBe(
      'authorization',
    );
    expect(
      classifyUpstreamError({ code: '23505', message: 'duplicate key value' }).subsystem,
    ).toBe('registration');
  });
});

describe('recovery invariants referenced by the gate', () => {
  const groupMap = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');
  const boundary = readFileSync(
    join(__dirname, '../components/AppErrorBoundary.tsx'),
    'utf8',
  );
  const uiAction = readFileSync(join(__dirname, '../utils/uiAction.ts'), 'utf8');
  const performance = readFileSync(join(__dirname, '../state/performance.ts'), 'utf8');
  const navigator = readFileSync(
    join(__dirname, '../navigation/RootNavigator.tsx'),
    'utf8',
  );

  it('map failure stays map-local; root retry does not clear session state', () => {
    expect(groupMap).toContain('MapSubtreeBoundary');
    expect(boundary).toContain('were not cleared');
    expect(boundary).toContain('react_render_retry');
  });

  it('action timeout/retry/cancel are auditable', () => {
    expect(uiAction).toContain('ui_action_timeout');
    expect(uiAction).toContain('ui_action_retry');
    expect(uiAction).toContain('ui_action_cancel');
    expect(uiAction).toContain('single-flight');
  });

  it('error outbox prioritizes errors and remains consent-gated', () => {
    expect(performance).toContain("CASE event_type WHEN 'error' THEN 0 ELSE 1 END");
    expect(performance).toContain('getDiagnosticConsentEnabled');
    expect(performance).toContain('notifyErrorRecorded');
  });

  it('stack has a single Map screen route name (no nested Map stacks in navigator)', () => {
    const mapScreens = navigator.match(/name="Map"/g) ?? [];
    expect(mapScreens.length).toBe(1);
  });
});
