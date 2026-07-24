/**
 * Ticket 03 — finite React/map recovery + classified errors stay off root render.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const logEvent = jest.fn();
const logError = jest.fn();

jest.mock('../utils/activityLog', () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
  logError: (...args: unknown[]) => logError(...args),
}));

// performance may be lazy-required from uiAction
jest.mock('../state/performance', () => ({
  setActiveActionContext: jest.fn((input: { actionId: string; screen: string }) => ({
    generation: 1,
    parentTraceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    actionId: input.actionId,
    screen: input.screen,
  })),
  clearActiveActionContext: jest.fn(),
  getLastScreenName: jest.fn(() => 'Map'),
  getLastRoute: jest.fn(() => ({ routeName: 'Map', routeKey: 'Map-1' })),
}));

import {
  clearUiActionFailure,
  getLastUiActionFailureForTests,
  resetUiActionStateForTests,
  retryLastUiAction,
  runUiAction,
  subscribeUiActionFailures,
} from '../utils/uiAction';
import { classifyUpstreamError } from '../utils/errorFingerprint';

describe('root / map recovery source contracts', () => {
  const boundary = readFileSync(
    join(__dirname, '../components/AppErrorBoundary.tsx'),
    'utf8',
  );
  const groupMap = readFileSync(join(__dirname, '../components/GroupMap.tsx'), 'utf8');
  const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
  const banner = readFileSync(
    join(__dirname, '../components/InteractionRecoveryBanner.tsx'),
    'utf8',
  );

  it('root boundary records component stack, route, screen and finite terminal state', () => {
    expect(boundary).toContain('componentStack');
    expect(boundary).toContain('getLastRoute');
    expect(boundary).toContain('getLastScreenName');
    expect(boundary).toContain('react_render_retry');
    expect(boundary).toContain('react_render_terminal');
    expect(boundary).toContain('Still not working');
    expect(boundary).toContain('were not cleared');
    expect(boundary).toContain('remountKey');
    expect(boundary).toContain('pendingRetryEpisode');
    expect(boundary).toContain('componentDidUpdate');
    // No timer-based remount of the whole app
    expect(boundary).not.toMatch(/setInterval/);
  });

  it('map-only boundary stays local (does not wrap whole app)', () => {
    expect(groupMap).toContain('MapSubtreeBoundary');
    expect(groupMap).toContain('map_surface_failure');
    expect(groupMap).toContain('map_surface_retry');
    expect(groupMap).toContain('remountUsed');
    expect(groupMap).not.toMatch(/setInterval\([^)]*setSurfaceKey/);
    // Root still uses AppErrorBoundary separately
    expect(app).toContain('AppErrorBoundary');
    expect(app).toContain('InteractionRecoveryBanner');
  });

  it('recovery banner offers retry and cancel only (shared surface)', () => {
    expect(banner).toContain('retryLastUiAction');
    expect(banner).toContain('clearUiActionFailure');
  });
});

describe('action timeout / reject / retry / cancel auditable events', () => {
  beforeEach(() => {
    resetUiActionStateForTests();
    logEvent.mockClear();
    logError.mockClear();
    jest.useRealTimers();
  });

  it('records action reject with actionId + screen (not root render)', async () => {
    await runUiAction(
      'test.action_reject',
      () => {
        throw new Error('boom');
      },
      { screen: 'Map' },
    );
    expect(logError).toHaveBeenCalledWith(
      'ui_action_error',
      expect.any(Error),
      expect.objectContaining({ actionId: 'test.action_reject', screen: 'Map' }),
    );
    expect(logEvent).toHaveBeenCalledWith(
      'ui_action_error',
      expect.objectContaining({ actionId: 'test.action_reject', outcome: 'failed' }),
    );
    // Must not be classified as react_render
    expect(logError).not.toHaveBeenCalledWith(
      'react_render',
      expect.anything(),
      expect.anything(),
    );
  });

  it('records action timeout with outcome and keeps canRetry', async () => {
    jest.useFakeTimers();
    const late = new Promise<void>(() => undefined);
    const pending = runUiAction('test.action_timeout', () => late, {
      screen: 'Map',
      timeoutMs: 50,
    });
    await jest.advanceTimersByTimeAsync(50);
    await pending;
    expect(logEvent).toHaveBeenCalledWith(
      'ui_action_timeout',
      expect.objectContaining({
        actionId: 'test.action_timeout',
        outcome: 'timeout',
      }),
    );
    expect(getLastUiActionFailureForTests()?.canRetry).toBe(true);
  });

  it('retry emits ui_action_retry and re-runs without clearing state', async () => {
    let attempts = 0;
    await runUiAction(
      'test.action_retry',
      () => {
        attempts += 1;
        if (attempts === 1) throw new Error('once');
        return 'ok';
      },
      { screen: 'Map' },
    );
    const result = await retryLastUiAction();
    expect(result).toBe('ok');
    expect(logEvent).toHaveBeenCalledWith(
      'ui_action_retry',
      expect.objectContaining({
        actionId: 'test.action_retry',
        outcome: 'retry_requested',
      }),
    );
    expect(attempts).toBe(2);
  });

  it('cancel emits ui_action_cancel without re-running the action', async () => {
    await runUiAction(
      'test.action_cancel',
      () => {
        throw new Error('nope');
      },
      { screen: 'Map' },
    );
    expect(getLastUiActionFailureForTests()?.actionId).toBe('test.action_cancel');
    clearUiActionFailure();
    expect(logEvent).toHaveBeenCalledWith(
      'ui_action_cancel',
      expect.objectContaining({
        actionId: 'test.action_cancel',
        outcome: 'cancelled',
      }),
    );
    expect(getLastUiActionFailureForTests()).toBeNull();
  });

  it('does not publish duplicate failure side effects while in-flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runUiAction('test.single_flight', () => gate, { screen: 'Map' });
    await Promise.resolve();
    const second = await runUiAction('test.single_flight', () => 'dup', { screen: 'Map' });
    expect(second).toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith(
      'ui_action_ignored',
      expect.objectContaining({ reason: 'in_flight' }),
    );
    release();
    await first;
  });
});

describe('classified upstream errors are not root-render', () => {
  it('leader role / maps 503 / token 409 are not react_render subsystem', () => {
    expect(classifyUpstreamError(new Error('leader role required')).subsystem).not.toBe(
      'react_render',
    );
    expect(
      classifyUpstreamError({
        name: 'MapsProxyError',
        code: 'upstream_unavailable',
        status: 503,
        message: 'x',
      }).subsystem,
    ).toBe('maps');
    expect(
      classifyUpstreamError({ code: '23505', message: 'duplicate key' }).subsystem,
    ).toBe('registration');
  });

  it('performance recordPerformanceError tags react_render only for that operation', () => {
    const performance = readFileSync(join(__dirname, '../state/performance.ts'), 'utf8');
    // Classified helpers exist; root render uses explicit operation from boundary.
    expect(performance).toContain('recordClassifiedError');
    expect(performance).toContain('classifyUpstreamError');
    const boundary = readFileSync(
      join(__dirname, '../components/AppErrorBoundary.tsx'),
      'utf8',
    );
    expect(boundary).toContain("subsystem: 'react_render'");
  });
});
