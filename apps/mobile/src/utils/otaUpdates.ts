/**
 * Production OTA bootstrap for TestFlight / store builds.
 *
 * Native check uses ON_LOAD + LaunchWaitMs, but with wait=0 the first open only
 * *downloads* and the next cold start applies. Users often force-quit before
 * the download finishes, so JS also checks, fetches, and reloads when ready.
 */
import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

// Jest may not define __DEV__; treat undefined as "dev" (never auto-OTA in tests).
const IS_DEV = typeof __DEV__ === 'undefined' ? true : __DEV__;
const OTA_USABLE = !IS_DEV && Updates.isEnabled;

let inFlight: Promise<boolean> | null = null;
let appStateSub: { remove: () => void } | null = null;

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
