import type { LocationSample } from '../../native/location';

export interface ForegroundLocationSourceOptions {
  nativeMapAvailable: boolean;
  watchLocation: (
    onSample: (sample: LocationSample) => void,
  ) => Promise<() => void> | (() => void);
  onSample: (sample: LocationSample) => void;
}

/**
 * Owns the choice between MapKit `onUserLocationChange` samples and the Expo
 * foreground watcher. Only one continuous owner should run at a time.
 */
export function createForegroundLocationSource(
  options: ForegroundLocationSourceOptions,
) {
  let stopWatch: (() => void) | null = null;
  let stopped = false;

  return {
    async start(): Promise<void> {
      if (stopped || options.nativeMapAvailable) return;
      const unsub = await options.watchLocation(options.onSample);
      if (stopped) {
        if (typeof unsub === 'function') unsub();
        return;
      }
      stopWatch = typeof unsub === 'function' ? unsub : null;
    },

    acceptMapSample(sample: LocationSample): void {
      if (stopped) return;
      options.onSample(sample);
    },

    stop(): void {
      stopped = true;
      stopWatch?.();
      stopWatch = null;
    },
  };
}
