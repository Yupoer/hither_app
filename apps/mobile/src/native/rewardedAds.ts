/**
 * Google Mobile Ads Rewarded + UMP consent wrapper.
 * Gracefully degrades when native module is missing (Expo Go / unsupported).
 *
 * Production ad units only in release-like builds; test units otherwise.
 * Client reward callback never credits tokens — verifying UI only.
 */
import { Platform } from 'react-native';
import {
  ADMOB_APP_IDS,
  ADMOB_REWARDED_UNITS,
  ADMOB_TEST_REWARDED_UNITS,
  type RewardedAdUiState,
} from '../store/types';

export type RewardedAdsAvailability =
  | { available: true }
  | { available: false; reason: 'expo_go' | 'missing_module' | 'init_failed' | 'unsupported' };

type MobileAdsModule = {
  mobileAds: () => { initialize: () => Promise<unknown> };
  RewardedAd: {
    createForAdRequest: (
      unitId: string,
      requestOptions?: { requestNonPersonalizedAdsOnly?: boolean },
    ) => RewardedAdInstance;
  };
  RewardedAdEventType: {
    LOADED: string;
    EARNED_REWARD: string;
  };
  AdEventType: {
    CLOSED: string;
    ERROR: string;
  };
  TestIds?: { REWARDED?: string };
};

type RewardedAdInstance = {
  addAdEventListener: (event: string, handler: (...args: unknown[]) => void) => () => void;
  load: () => void;
  show: () => Promise<void>;
  setServerSideVerificationOptions?: (opts: {
    customData?: string;
    userId?: string;
  }) => void;
};

type AdsConsentModule = {
  AdsConsent: {
    requestInfoUpdate: () => Promise<{ canRequestAds?: boolean; isConsentFormAvailable?: boolean }>;
    loadAndShowConsentFormIfRequired: () => Promise<{ canRequestAds?: boolean }>;
    getConsentInfo?: () => Promise<{ canRequestAds?: boolean }>;
  };
};

let cachedModule: MobileAdsModule | null | undefined;
let initPromise: Promise<RewardedAdsAvailability> | null = null;

function loadModule(): MobileAdsModule | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // Optional native dependency — absent in Expo Go / pure JS.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('react-native-google-mobile-ads') as MobileAdsModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

function loadConsent(): AdsConsentModule['AdsConsent'] | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-google-mobile-ads') as AdsConsentModule;
    return mod.AdsConsent ?? null;
  } catch {
    return null;
  }
}

/** True for production / release-like native builds. */
export function useProductionAdUnits(): boolean {
  // __DEV__ is false in release; prefer that over Constants which may be missing in tests.
  if (typeof __DEV__ !== 'undefined' && __DEV__) return false;
  return true;
}

export function rewardedAdUnitForPlatform(
  platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android',
): string {
  if (useProductionAdUnits()) {
    return platform === 'ios' ? ADMOB_REWARDED_UNITS.ios : ADMOB_REWARDED_UNITS.android;
  }
  return platform === 'ios'
    ? ADMOB_TEST_REWARDED_UNITS.ios
    : ADMOB_TEST_REWARDED_UNITS.android;
}

export function admobAppIdForPlatform(
  platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android',
): string {
  return platform === 'ios' ? ADMOB_APP_IDS.ios : ADMOB_APP_IDS.android;
}

export async function ensureRewardedAdsReady(): Promise<RewardedAdsAvailability> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return { available: false, reason: 'unsupported' as const };
    }
    const mod = loadModule();
    if (!mod?.mobileAds || !mod.RewardedAd) {
      return { available: false, reason: 'missing_module' as const };
    }
    try {
      const consent = loadConsent();
      if (consent?.requestInfoUpdate) {
        const info = await consent.requestInfoUpdate();
        if (info.isConsentFormAvailable && consent.loadAndShowConsentFormIfRequired) {
          await consent.loadAndShowConsentFormIfRequired();
        }
      }
      await mod.mobileAds().initialize();
      return { available: true as const };
    } catch {
      return { available: false, reason: 'init_failed' as const };
    }
  })();
  return initPromise;
}

export type RewardedAdController = {
  load: (sessionRef: string) => Promise<RewardedAdUiState>;
  show: () => Promise<RewardedAdUiState>;
  dispose: () => void;
};

/**
 * Create a one-shot rewarded ad controller bound to a session ref (SSV custom data).
 * EARNED_REWARD → 'verifying' only (never mutates wallet).
 */
export function createRewardedAdController(
  platform: 'ios' | 'android',
  handlers?: {
    onState?: (state: RewardedAdUiState) => void;
  },
): RewardedAdController | null {
  const mod = loadModule();
  if (!mod?.RewardedAd) return null;

  let ad: RewardedAdInstance | null = null;
  let unsubs: Array<() => void> = [];
  let loaded = false;
  let earned = false;

  const emit = (state: RewardedAdUiState) => {
    handlers?.onState?.(state);
  };

  const dispose = () => {
    for (const u of unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    unsubs = [];
    ad = null;
    loaded = false;
    earned = false;
  };

  return {
    async load(sessionRef: string) {
      dispose();
      emit('loading');
      const unitId = rewardedAdUnitForPlatform(platform);
      try {
        ad = mod.RewardedAd.createForAdRequest(unitId);
        if (typeof ad.setServerSideVerificationOptions === 'function') {
          ad.setServerSideVerificationOptions({ customData: sessionRef });
        }
        const loadedType = mod.RewardedAdEventType.LOADED;
        const earnedType = mod.RewardedAdEventType.EARNED_REWARD;
        const closedType = mod.AdEventType.CLOSED;
        const errorType = mod.AdEventType.ERROR;

        await new Promise<void>((resolve, reject) => {
          unsubs.push(
            ad!.addAdEventListener(loadedType, () => {
              loaded = true;
              emit('ready');
              resolve();
            }),
          );
          unsubs.push(
            ad!.addAdEventListener(errorType, (err: unknown) => {
              const msg = String((err as { message?: string })?.message ?? err ?? '');
              if (/fill|no.?fill|ERROR_CODE_NO_FILL|3\b/i.test(msg)) {
                emit('no_fill');
              } else if (/network|offline|timeout/i.test(msg)) {
                emit('network_error');
              } else {
                emit('error');
              }
              reject(err instanceof Error ? err : new Error(msg || 'ad_error'));
            }),
          );
          unsubs.push(
            ad!.addAdEventListener(earnedType, () => {
              earned = true;
              // Verifying only — server SSV credits the wallet.
              emit('verifying');
            }),
          );
          unsubs.push(
            ad!.addAdEventListener(closedType, () => {
              emit(earned ? 'verifying' : 'dismissed');
            }),
          );
          ad!.load();
        });
        return loaded ? 'ready' : 'error';
      } catch {
        return 'error';
      }
    },
    async show() {
      if (!ad || !loaded) {
        emit('error');
        return 'error';
      }
      emit('showing');
      try {
        await ad.show();
        if (earned) return 'verifying';
        // Some platforms fire CLOSED before EARNED_REWARD. Brief grace so we
        // do not treat a completed watch as dismiss and kill the SSV session.
        await new Promise<void>((r) => setTimeout(r, 900));
        if (earned) {
          emit('verifying');
          return 'verifying';
        }
        return 'dismissed';
      } catch {
        emit('error');
        return 'error';
      }
    },
    dispose,
  };
}

/** Test helper: clear module cache. */
export function __resetRewardedAdsForTests(): void {
  cachedModule = undefined;
  initPromise = null;
}
