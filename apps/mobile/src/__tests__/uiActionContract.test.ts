jest.mock('../api/supabase', () => ({
  supabase: { from: jest.fn(), auth: { getSession: jest.fn() } },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const logEvent = jest.fn();
const logError = jest.fn();

jest.mock('../utils/activityLog', () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
  logError: (...args: unknown[]) => logError(...args),
}));

import {
  isUiActionInFlight,
  resetUiActionStateForTests,
  runUiAction,
  retryLastUiAction,
  getLastUiActionFailureForTests,
  clearUiActionFailure,
  subscribeUiActionFailures,
  DEFAULT_UI_ACTION_TIMEOUT_MS,
} from '../utils/uiAction';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('runUiAction contract', () => {
  beforeEach(() => {
    resetUiActionStateForTests();
    logEvent.mockClear();
    logError.mockClear();
    jest.useRealTimers();
  });

  it('resolves sync success and emits start/success with duration', async () => {
    const result = await runUiAction('test.sync_ok', () => 42, { screen: 'Test' });
    expect(result).toBe(42);
    expect(logEvent).toHaveBeenCalledWith(
      'ui_action_start',
      expect.objectContaining({ actionId: 'test.sync_ok', screen: 'Test' }),
    );
    expect(logEvent).toHaveBeenCalledWith(
      'ui_action_success',
      expect.objectContaining({ actionId: 'test.sync_ok', screen: 'Test' }),
    );
    const successPayload = logEvent.mock.calls.find((c) => c[0] === 'ui_action_success')?.[1] as {
      durationMs?: number;
    };
    expect(typeof successPayload?.durationMs).toBe('number');
  });

  it('catches sync throw and reports error without rethrowing', async () => {
    const onError = jest.fn();
    const onBusyChange = jest.fn();
    const result = await runUiAction(
      'test.sync_throw',
      () => {
        throw new Error('boom');
      },
      { screen: 'Test', onError, onBusyChange },
    );
    expect(result).toBeUndefined();
    expect(onError).toHaveBeenCalledWith('error');
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(logEvent).toHaveBeenCalledWith(
      'ui_action_error',
      expect.objectContaining({ actionId: 'test.sync_throw' }),
    );
    expect(logError).toHaveBeenCalledWith(
      'ui_action_error',
      expect.any(Error),
      expect.objectContaining({ actionId: 'test.sync_throw' }),
    );
  });

  it('catches rejected promises', async () => {
    const onError = jest.fn();
    const result = await runUiAction(
      'test.reject',
      async () => {
        throw new Error('nope');
      },
      { screen: 'Test', onError },
    );
    expect(result).toBeUndefined();
    expect(onError).toHaveBeenCalledWith('error');
    expect(logEvent).toHaveBeenCalledWith(
      'ui_action_error',
      expect.objectContaining({ actionId: 'test.reject' }),
    );
  });

  it('ignores double-tap while in flight (single-flight)', async () => {
    let release!: () => void;
    const gate = new Promise<string>((resolve) => {
      release = () => resolve('done');
    });

    const first = runUiAction('test.double', () => gate, { screen: 'Test' });
    // Let the first action register in-flight.
    await Promise.resolve();
    expect(isUiActionInFlight('test.double')).toBe(true);

    const second = await runUiAction('test.double', () => 'second', { screen: 'Test' });
    expect(second).toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith(
      'ui_action_ignored',
      expect.objectContaining({ actionId: 'test.double', reason: 'in_flight' }),
    );

    release();
    await expect(first).resolves.toBe('done');
    expect(isUiActionInFlight('test.double')).toBe(false);
  });

  it('times out, clears busy, and allows retry', async () => {
    jest.useFakeTimers();
    const onBusyChange = jest.fn();
    const onError = jest.fn();
    let resolveLate!: (v: string) => void;
    const late = new Promise<string>((resolve) => {
      resolveLate = resolve;
    });

    const pending = runUiAction('test.timeout', () => late, {
      screen: 'Test',
      timeoutMs: 100,
      onBusyChange,
      onError,
    });

    await jest.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(result).toBeUndefined();
    expect(onError).toHaveBeenCalledWith('timeout');
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(logEvent).toHaveBeenCalledWith(
      'ui_action_timeout',
      expect.objectContaining({ actionId: 'test.timeout', timeoutMs: 100 }),
    );
    expect(isUiActionInFlight('test.timeout')).toBe(false);

    // Late resolution must not throw; token is stale for callers.
    resolveLate('too-late');
    await Promise.resolve();

    // Retry after timeout is allowed.
    const retry = await runUiAction('test.timeout', () => 'ok', {
      screen: 'Test',
      timeoutMs: 1000,
    });
    expect(retry).toBe('ok');
  });

  it('finally clears busy even when task succeeds', async () => {
    const onBusyChange = jest.fn();
    await runUiAction('test.finally', async () => 'x', {
      screen: 'Test',
      onBusyChange,
    });
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it('exposes a request token that is current mid-flight and stale after finish/timeout', async () => {
    let observedCurrent = false;
    let lateTokenCheck: (() => boolean) | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = runUiAction(
      'test.token',
      async (token) => {
        observedCurrent = token.isCurrent();
        lateTokenCheck = () => token.isCurrent();
        await gate;
        return 'first';
      },
      { screen: 'Test' },
    );

    await Promise.resolve();
    expect(observedCurrent).toBe(true);
    expect(lateTokenCheck?.()).toBe(true);
    release();
    await pending;
    // After the run finishes, the same token is no longer current.
    expect(lateTokenCheck?.()).toBe(false);
  });

  it('defaults timeout to 15 seconds', () => {
    expect(DEFAULT_UI_ACTION_TIMEOUT_MS).toBe(15_000);
  });

  it('publishes failures for the recovery banner with canRetry', async () => {
    const seen: Array<{ kind: string; canRetry: boolean } | null> = [];
    const unsub = subscribeUiActionFailures((f) => {
      if (f) seen.push({ kind: f.kind, canRetry: f.canRetry });
      else seen.push(null);
    });
    await runUiAction(
      'test.publish',
      () => {
        throw new Error('fail');
      },
      { screen: 'Test' },
    );
    expect(getLastUiActionFailureForTests()).toEqual(
      expect.objectContaining({ actionId: 'test.publish', kind: 'error', canRetry: true }),
    );
    expect(seen.some((s) => s && s.kind === 'error' && s.canRetry)).toBe(true);
    clearUiActionFailure();
    expect(getLastUiActionFailureForTests()).toBeNull();
    unsub();
  });

  it('retries the last failed runnable via retryLastUiAction', async () => {
    let attempts = 0;
    await runUiAction(
      'test.retry_me',
      () => {
        attempts += 1;
        throw new Error('first');
      },
      { screen: 'Test' },
    );
    expect(attempts).toBe(1);
    expect(getLastUiActionFailureForTests()?.actionId).toBe('test.retry_me');

    const retryResult = await retryLastUiAction();
    // Second run also throws — still records error, returns undefined.
    expect(retryResult).toBeUndefined();
    expect(attempts).toBe(2);

    // Successful retry path: fail once, then succeed on retry with a mutable task.
    let phase = 0;
    await runUiAction(
      'test.retry_ok',
      () => {
        phase += 1;
        if (phase === 1) throw new Error('once');
        return 'ok';
      },
      { screen: 'Test' },
    );
    const ok = await retryLastUiAction();
    expect(ok).toBe('ok');
    expect(getLastUiActionFailureForTests()).toBeNull();
  });

  it('does not publish banner failures when suppressBanner is set', async () => {
    const listener = jest.fn();
    const unsub = subscribeUiActionFailures(listener);
    listener.mockClear();
    await runUiAction(
      'test.suppress',
      () => {
        throw new Error('x');
      },
      { screen: 'Test', suppressBanner: true },
    );
    // Initial subscribe may have called with null; after error still no failure payload.
    expect(listener).not.toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'test.suppress' }),
    );
    unsub();
  });
});

describe('SafePressable source contract', () => {
  const source = readFileSync(join(__dirname, '../components/SafePressable.tsx'), 'utf8');

  it('routes press through runUiAction and exposes busy accessibility', () => {
    expect(source).toContain('runUiAction');
    expect(source).toContain('actionId');
    expect(source).toContain('onBusyChange');
    expect(source).toContain('suppressBanner');
    expect(source).toContain('accessibilityState');
    expect(source).toContain('disableWhileBusy');
  });
});

describe('InteractionRecoveryBanner source contract', () => {
  const source = readFileSync(
    join(__dirname, '../components/InteractionRecoveryBanner.tsx'),
    'utf8',
  );

  it('offers retry and cancel, not dismiss-only', () => {
    expect(source).toContain('retryLastUiAction');
    expect(source).toContain('clearUiActionFailure');
    expect(source).toContain("t('interaction.retry')");
    expect(source).toContain("t('common.cancel')");
    expect(source).not.toMatch(/t\('common\.confirm'\)/);
  });
});
