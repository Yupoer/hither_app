/**
 * Production OTA bootstrap for TestFlight / store builds.
 *
 * Native check uses ON_LOAD + LaunchWaitMs, but with wait=0 the first open only
 * *downloads* and the next cold start applies. Users often force-quit before
 * the download finishes, so JS also checks, fetches, and reloads when ready.
 *
 * After a new bundle is launched, {@link consumeOtaAppliedNotice} returns true
 * once so the root UI can show a brief top toast on any screen.
 */
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';

// Jest may not define __DEV__; treat undefined as "dev" (never auto-OTA in tests).
const IS_DEV = typeof __DEV__ === 'undefined' ? true : __DEV__;
const OTA_USABLE = !IS_DEV && Updates.isEnabled;

/** Persisted last-seen EAS update id (or "embedded"). */
export const OTA_LAST_UPDATE_ID_KEY = 'hither.ota.lastUpdateId';

let inFlight: Promise<boolean> | null = null;
let appStateSub: { remove: () => void } | null = null;

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

/**
 * Check for a remote update, download it if needed, and reload into it.
 * Returns true when a reload was initiated (process will restart).
 */
export async function applyOtaUpdateIfAvailable(): Promise<boolean> {
  if (!OTA_USABLE) return false;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) return false;
      const fetched = await Updates.fetchUpdateAsync();
      if (!fetched.isNew) return false;
      await Updates.reloadAsync();
      return true;
    } catch {
      // Network / rate-limit / disabled channel — keep running current bundle.
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Start background OTA checks: once on boot, and when the app returns to
 * foreground (so a downloaded-but-pending update can apply without a kill).
 */
export function startOtaUpdateBootstrap(): () => void {
  if (!OTA_USABLE) return () => undefined;

  void applyOtaUpdateIfAvailable();

  const onAppState = (next: AppStateStatus) => {
    if (next === 'active') {
      void applyOtaUpdateIfAvailable();
    }
  };

  appStateSub?.remove();
  appStateSub = AppState.addEventListener('change', onAppState);

  return () => {
    appStateSub?.remove();
    appStateSub = null;
  };
}
