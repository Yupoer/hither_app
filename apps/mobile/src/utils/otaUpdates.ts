/**
 * Production OTA bootstrap for TestFlight / store builds.
 *
 * Native check uses ON_LOAD + LaunchWaitMs, but with wait=0 the first open only
 * *downloads* and the next cold start applies. Users often force-quit before
 * the download finishes, so JS also checks, fetches, and reloads when ready.
 *
 * Manual Settings "立即更新" and automatic bootstrap share a single-flight
 * lifecycle so double-taps / concurrent apply cannot stack reloads.
 *
 * After a new bundle is launched, {@link consumeOtaAppliedNotice} returns true
 * once so the root UI can show a brief top toast on any screen.
 *
 * `Updates.reloadAsync` is an intentional process reload — not a crash —
 * unless the subsequent launch records a native termination or unhandled error.
 */
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';

// Jest may not define __DEV__; treat undefined as "dev" (never auto-OTA in tests).
const IS_DEV = typeof __DEV__ === 'undefined' ? true : __DEV__;

/** Test override — null means use production usability rules. */
let otaUsableOverride: boolean | null = null;

/**
 * Whether OTA apply may call expo-updates. Overridable in unit tests so
 * single-flight can be exercised without a production binary.
 */
export function isOtaUsable(): boolean {
  if (otaUsableOverride != null) return otaUsableOverride;
  return !IS_DEV && Updates.isEnabled;
}

/** @internal test-only */
export function __setOtaUsableForTests(value: boolean | null): void {
  otaUsableOverride = value;
}

/** Persisted last-seen EAS update id (or "embedded"). */
export const OTA_LAST_UPDATE_ID_KEY = 'hither.ota.lastUpdateId';

export type OtaApplyStatus =
  | 'disabled'
  | 'busy'
  | 'no_update'
  | 'fetch_failed'
  | 'reload_failed'
  | 'reloading';

export interface OtaApplyResult {
  status: OtaApplyStatus;
  /** True only when reloadAsync was invoked (process will restart). */
  reloading: boolean;
}

export interface OtaApplyOptions {
  manual?: boolean;
  /** Pending update already known; skip checkForUpdateAsync. */
  skipCheck?: boolean;
}

let inFlight: Promise<OtaApplyResult> | null = null;
/**
 * Manual waiter requested while another flight was running. Drained **inside**
 * the shared flight promise so every waiter sees the final outcome (including
 * a successful manual follow-up reload).
 */
let pendingManualFollowUp: OtaApplyOptions | null = null;
let appStateSub: { remove: () => void } | null = null;

function result(status: OtaApplyStatus): OtaApplyResult {
  return { status, reloading: status === 'reloading' };
}

/**
 * Pure decision: show "已更新" when the running update id changed since last launch.
 * First install (no lastSeen) does not toast.
 */
export function shouldShowOtaAppliedToast(input: {
  lastSeenId: string | null | undefined;
  currentId: string | null | undefined;
  isEmbeddedLaunch: boolean;
}): boolean {
  if (input.isEmbeddedLaunch) return false;
  const current = input.currentId?.trim();
  if (!current) return false;
  const last = input.lastSeenId?.trim();
  if (!last) return false;
  return last !== current;
}

export function currentOtaLaunchId(): string {
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return 'embedded';
  return Updates.updateId;
}

/**
 * Compare current launch to the last persisted update id, then persist current.
 * Returns true once when a new (non-embedded) update was applied.
 */
export async function consumeOtaAppliedNotice(): Promise<boolean> {
  try {
    const currentId = currentOtaLaunchId();
    const lastSeenId = await AsyncStorage.getItem(OTA_LAST_UPDATE_ID_KEY);
    const show = shouldShowOtaAppliedToast({
      lastSeenId,
      currentId: currentId === 'embedded' ? null : currentId,
      isEmbeddedLaunch: currentId === 'embedded',
    });
    if (lastSeenId !== currentId) {
      await AsyncStorage.setItem(OTA_LAST_UPDATE_ID_KEY, currentId);
    }
    return show;
  } catch {
    return false;
  }
}

async function runOtaApply(opts: OtaApplyOptions): Promise<OtaApplyResult> {
  const manual = Boolean(opts.manual);
  const skipCheck = Boolean(opts.skipCheck);

  try {
    if (!skipCheck) {
      try {
        const check = await Updates.checkForUpdateAsync();
        if (!check.isAvailable) return result('no_update');
      } catch {
        if (!manual) return result('no_update');
        // Manual: still attempt fetch after a flaky check.
      }
    }

    try {
      const fetched = await Updates.fetchUpdateAsync();
      // Auto path only reloads when the fetch reports a new bundle.
      // Manual + skipCheck (pending already on disk) always reloads.
      if (!fetched.isNew && !(manual && skipCheck)) {
        return result('no_update');
      }
    } catch {
      return result(manual ? 'fetch_failed' : 'no_update');
    }

    try {
      await Updates.reloadAsync();
      return result('reloading');
    } catch {
      return result(manual ? 'reload_failed' : 'no_update');
    }
  } catch {
    return result(manual ? 'fetch_failed' : 'no_update');
  }
}

/**
 * Check for a remote update, download it if needed, and reload into it.
 * Single-flight: concurrent callers never stack reloads.
 *
 * Join semantics:
 * - Concurrent callers await the **same** promise and see the final outcome.
 * - A **manual** caller that joins an **auto** flight sets
 *   `pendingManualFollowUp`. If the auto flight soft-finishes (no reload),
 *   one manual follow-up runs **inside** that shared promise so Settings
 *   「立即更新」is not soft-swallowed and reloadAsync still fires at most once
 *   per upgrade chain.
 *
 * @param opts.manual — Settings "立即更新". Surfaces fetch/reload failure statuses.
 * @param opts.skipCheck — Pending update already known; skip checkForUpdateAsync.
 */
export async function applyOtaUpdate(
  opts?: OtaApplyOptions,
): Promise<OtaApplyResult> {
  if (!isOtaUsable()) return result('disabled');

  const request: OtaApplyOptions = {
    manual: Boolean(opts?.manual),
    skipCheck: Boolean(opts?.skipCheck),
  };

  if (inFlight) {
    if (request.manual) {
      pendingManualFollowUp = {
        manual: true,
        skipCheck:
          Boolean(pendingManualFollowUp?.skipCheck) || Boolean(request.skipCheck),
      };
    }
    // Share the full chain (including any manual follow-up drained inside).
    return inFlight;
  }

  inFlight = (async () => {
    try {
      let out = await runOtaApply(request);
      // Drain manual upgrades inside this shared promise so every waiter
      // (auto bootstrap + Settings CTA) observes the same final result.
      while (!out.reloading && pendingManualFollowUp) {
        const follow = pendingManualFollowUp;
        pendingManualFollowUp = null;
        out = await runOtaApply(follow);
      }
      return out;
    } finally {
      inFlight = null;
      pendingManualFollowUp = null;
    }
  })();

  return inFlight;
}

/**
 * Background / auto path: check → fetch → reload when available.
 * Returns true when a reload was initiated (process will restart).
 */
export async function applyOtaUpdateIfAvailable(): Promise<boolean> {
  const outcome = await applyOtaUpdate({ manual: false });
  return outcome.reloading;
}

/** True while an apply is in flight (manual or automatic). */
export function isOtaApplyInFlight(): boolean {
  return inFlight != null;
}

/**
 * Start background OTA checks: once on boot, and when the app returns to
 * foreground (so a downloaded-but-pending update can apply without a kill).
 */
export function startOtaUpdateBootstrap(): () => void {
  if (!isOtaUsable()) return () => undefined;

  // Share single-flight with manual apply — never start a second reload.
  void applyOtaUpdate({ manual: false });

  const onAppState = (next: AppStateStatus) => {
    if (next === 'active') {
      void applyOtaUpdate({ manual: false });
    }
  };

  appStateSub?.remove();
  appStateSub = AppState.addEventListener('change', onAppState);

  return () => {
    appStateSub?.remove();
    appStateSub = null;
  };
}
