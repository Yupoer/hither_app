/**
 * Shared UI action runner for button-like interactions.
 *
 * Contract (docs/superpowers/specs/2026-07-24-android-interaction-resilience-design.md §4.1):
 * - single-flight per actionId
 * - catch sync throw + Promise reject
 * - timeout ends UI busy (does not claim network cancel)
 * - finally clears busy
 * - request token ignores late results from older generations
 * - sanitized telemetry only (actionId, screen, duration, category)
 * - global failure banner supports retry of the last failed runnable + cancel
 */

import { logError, logEvent } from './activityLog';

export const DEFAULT_UI_ACTION_TIMEOUT_MS = 15_000;

export type UiActionErrorKind = 'error' | 'timeout';

export type UiActionFailure = {
  actionId: string;
  screen: string;
  kind: UiActionErrorKind;
  at: number;
  /** True when the banner can re-run the same actionId/task. */
  canRetry: boolean;
};

export type UiActionOptions = {
  screen: string;
  timeoutMs?: number;
  onBusyChange?: (busy: boolean) => void;
  onError?: (kind: UiActionErrorKind) => void;
  /** When true, skip the global recovery banner (caller shows its own UI). */
  suppressBanner?: boolean;
};

type FailureListener = (failure: UiActionFailure | null) => void;
const failureListeners = new Set<FailureListener>();
let lastFailure: UiActionFailure | null = null;

type Runnable = {
  actionId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  task: (token: UiActionToken) => any;
  options: UiActionOptions;
};

/** Last failed runnable so the recovery banner can offer Retry. */
let lastFailedRunnable: Runnable | null = null;

/** Subscribe to global action failures for the root recovery banner. */
export function subscribeUiActionFailures(listener: FailureListener): () => void {
  failureListeners.add(listener);
  listener(lastFailure);
  return () => {
    failureListeners.delete(listener);
  };
}

export function clearUiActionFailure(): void {
  lastFailure = null;
  lastFailedRunnable = null;
  for (const listener of failureListeners) listener(null);
}

/**
 * Re-run the last failed action (same actionId + task + options).
 * Clears the banner first so busy/timeout state can publish a fresh failure.
 */
export async function retryLastUiAction(): Promise<unknown> {
  const runnable = lastFailedRunnable;
  if (!runnable) return undefined;
  // Clear failure UI but keep runnable reference via local const.
  lastFailure = null;
  lastFailedRunnable = null;
  for (const listener of failureListeners) listener(null);
  return runUiAction(runnable.actionId, runnable.task, runnable.options);
}

function publishFailure(
  failure: UiActionFailure,
  runnable: Runnable | null,
  suppressBanner?: boolean,
): void {
  if (suppressBanner) return;
  lastFailure = failure;
  lastFailedRunnable = runnable;
  for (const listener of failureListeners) listener(failure);
}

/** Generation token returned so callers can ignore late async side effects. */
export type UiActionToken = {
  actionId: string;
  generation: number;
  isCurrent: () => boolean;
};

const inFlight = new Map<string, number>();
const generations = new Map<string, number>();

function nextGeneration(actionId: string): number {
  const next = (generations.get(actionId) ?? 0) + 1;
  generations.set(actionId, next);
  return next;
}

function makeToken(actionId: string, generation: number): UiActionToken {
  return {
    actionId,
    generation,
    // Current only while this generation owns the in-flight slot. Timeout,
    // success, and error all clear the slot in `finally`, so late Promise
    // continuations see a stale token and must not update UI.
    isCurrent: () => inFlight.get(actionId) === generation,
  };
}

/** Test/reset helper — clears single-flight and generation state. */
export function resetUiActionStateForTests(): void {
  inFlight.clear();
  generations.clear();
  lastFailure = null;
  lastFailedRunnable = null;
  for (const listener of failureListeners) listener(null);
}

export function isUiActionInFlight(actionId: string): boolean {
  return inFlight.has(actionId);
}

export function getLastUiActionFailureForTests(): UiActionFailure | null {
  return lastFailure;
}

/**
 * Run a button-like side-effecting task under the shared safety contract.
 * Returns the task result, or `undefined` on ignore / error / timeout.
 */
export async function runUiAction<T>(
  actionId: string,
  task: (token: UiActionToken) => T | Promise<T>,
  options: UiActionOptions,
): Promise<T | undefined> {
  if (inFlight.has(actionId)) {
    logEvent('ui_action_ignored', {
      actionId,
      screen: options.screen,
      reason: 'in_flight',
    });
    return undefined;
  }

  const generation = nextGeneration(actionId);
  const token = makeToken(actionId, generation);
  const timeoutMs = options.timeoutMs ?? DEFAULT_UI_ACTION_TIMEOUT_MS;
  const startedAt = Date.now();
  const runnable: Runnable = { actionId, task, options };

  inFlight.set(actionId, generation);
  options.onBusyChange?.(true);
  logEvent('ui_action_start', {
    actionId,
    screen: options.screen,
    timeoutMs,
  });

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const clearBusy = () => {
    if (inFlight.get(actionId) === generation) {
      inFlight.delete(actionId);
    }
    options.onBusyChange?.(false);
  };

  try {
    const resultPromise = Promise.resolve().then(() => task(token));

    const timeoutPromise = new Promise<'__timeout__'>((resolve) => {
      timeoutId = setTimeout(() => resolve('__timeout__'), timeoutMs);
    });

    const raced = await Promise.race([
      resultPromise.then((value) => ({ kind: 'result' as const, value })),
      timeoutPromise.then(() => ({ kind: 'timeout' as const })),
    ]);

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (raced.kind === 'timeout') {
      timedOut = true;
      const durationMs = Date.now() - startedAt;
      logEvent('ui_action_timeout', {
        actionId,
        screen: options.screen,
        durationMs,
        timeoutMs,
      });
      options.onError?.('timeout');
      publishFailure(
        {
          actionId,
          screen: options.screen,
          kind: 'timeout',
          at: Date.now(),
          canRetry: true,
        },
        runnable,
        options.suppressBanner,
      );
      // Do not await the underlying task; late results are ignored via token.
      void resultPromise.then(
        () => undefined,
        () => undefined,
      );
      return undefined;
    }

    // Result may still arrive after a newer generation advanced — ignore.
    if (!token.isCurrent()) {
      logEvent('ui_action_ignored', {
        actionId,
        screen: options.screen,
        reason: 'stale_generation',
        durationMs: Date.now() - startedAt,
      });
      return undefined;
    }

    logEvent('ui_action_success', {
      actionId,
      screen: options.screen,
      durationMs: Date.now() - startedAt,
    });
    return raced.value;
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (!timedOut && token.isCurrent()) {
      logError('ui_action_error', error, {
        actionId,
        screen: options.screen,
        durationMs: Date.now() - startedAt,
      });
      logEvent('ui_action_error', {
        actionId,
        screen: options.screen,
        durationMs: Date.now() - startedAt,
      });
      options.onError?.('error');
      publishFailure(
        {
          actionId,
          screen: options.screen,
          kind: 'error',
          at: Date.now(),
          canRetry: true,
        },
        runnable,
        options.suppressBanner,
      );
    }
    return undefined;
  } finally {
    clearBusy();
  }
}
