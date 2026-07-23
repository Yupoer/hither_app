import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  exceptionKind,
  fnv1aHex,
  normalizeStackFrame,
  stackHash,
} from '../utils/errorFingerprint';

const boundary = readFileSync(
  join(__dirname, '../components/AppErrorBoundary.tsx'),
  'utf8',
);
const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
const activityLog = readFileSync(join(__dirname, '../utils/activityLog.ts'), 'utf8');
const scheduler = readFileSync(join(__dirname, '../state/logBatchScheduler.ts'), 'utf8');

describe('AppErrorBoundary and error telemetry contracts', () => {
  it('wraps the app root and records react_render without replacing ErrorUtils', () => {
    expect(app).toContain('AppErrorBoundary');
    expect(app).toContain('<AppErrorBoundary>');
    expect(app).toContain('installGlobalErrorLogger()');
    expect(app).toContain('flushPerformance');
    expect(app).toContain("AppState.addEventListener('change'");
    expect(app).toContain('setLastLaunchPhase');

    expect(boundary).toContain('componentDidCatch');
    expect(boundary).toContain("logError('react_render'");
    expect(boundary).toContain('getLastScreenName');
    expect(boundary).toContain('Retry');
  });

  it('global ErrorUtils handler still chains to the original handler', () => {
    expect(activityLog).toContain('getGlobalHandler');
    expect(activityLog).toContain('setGlobalHandler');
    expect(activityLog).toContain('originalHandler(error, isFatal)');
    expect(activityLog).toContain("recordPerformanceError('unhandled_exception'");
  });

  it('schedules a short debounce flush for errors', () => {
    expect(scheduler).toContain('export function notifyErrorRecorded');
    expect(scheduler).toContain('ERROR_FLUSH_DEBOUNCE_MS = 1_500');
  });

  it('fingerprints errors without raw messages', () => {
    const err = new Error('secret token abc');
    err.stack = 'Error: secret token abc\n    at foo (/Users/me/app/src/Foo.tsx:10:5)';
    expect(exceptionKind(err)).toBe('Error');
    expect(stackHash(err)).toMatch(/^[0-9a-f]{8}$/);
    expect(stackHash(err)).toBe(stackHash(err));
    expect(normalizeStackFrame('    at foo (/Users/me/app/src/Foo.tsx:10:5)')).not.toContain(
      '/Users/me',
    );
    expect(fnv1aHex('a')).not.toBe(fnv1aHex('b'));
  });
});
