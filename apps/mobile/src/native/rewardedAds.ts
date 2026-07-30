/**
 * Google Mobile Ads Rewarded + UMP consent wrapper.
 * Gracefully degrades when native module is missing (Expo Go / unsupported).
 *
 * Production ad units only in release-like builds; test units otherwise.
 * Client reward callback never credits tokens — verifying UI only.
 *
 * SSV custom data MUST be passed via RewardedAd.createForAdRequest(unit, {
 *   serverSideVerificationOptions: { customData },
 * }) — not via a nonexistent instance setter on v16.
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
  | {
      available: false;
      reason:
        | 'expo_go'
        | 'missing_module'
        | 'init_failed'
        | 'unsupported'
        | 'consent_required';
    };

type AdRequestOptions = {
  requestNonPersonalizedAdsOnly?: boolean;
  serverSideVerificationOptions?: {
    customData?: string;
    userId?: string;
  };
};

type MobileAdsModule = {
  mobileAds: () => { initialize: () => Promise<unknown> };
  RewardedAd: {
    createForAdRequest: (
      unitId: string,
      requestOptions?: AdRequestOptions,
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
export function productionAdUnitsEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return false;
  return true;
}

/** @deprecated Use productionAdUnitsEnabled — name avoided "use" prefix (eslint hooks). */
export function useProductionAdUnits(): boolean {
  return productionAdUnitsEnabled();
}

export function rewardedAdUnitForPlatform(
  platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android',
): string {
  if (productionAdUnitsEnabled()) {
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

/**
 * UMP consent then Mobile Ads init. Never request ads when canRequestAds is false.
 * Consent denial is recoverable (next call re-runs UMP).
 */
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
      // Fail-closed: only request ads after an explicit canRequestAds === true.
      // Missing AdsConsent / requestInfoUpdate → consent_required (no ads).
      const consent = loadConsent();
      let canRequestAds = false;
      if (consent?.requestInfoUpdate) {
        const info = await consent.requestInfoUpdate();
        canRequestAds = info.canRequestAds === true;
        if (info.isConsentFormAvailable && consent.loadAndShowConsentFormIfRequired) {
          const afterForm = await consent.loadAndShowConsentFormIfRequired();
          if (typeof afterForm?.canRequestAds === 'boolean') {
            canRequestAds = afterForm.canRequestAds === true;
          }
        }
      }
      if (!canRequestAds) {
        initPromise = null;
        return { available: false, reason: 'consent_required' as const };
      }
      await mod.mobileAds().initialize();
      return { available: true as const };
    } catch {
      initPromise = null;
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
 * show() resolves from ad events (CLOSED / EARNED_REWARD), not from the show() Promise.
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
  let loadFailure: RewardedAdUiState = 'error';
  const loadedType = mod.RewardedAdEventType.LOADED;
  const earnedType = mod.RewardedAdEventType.EARNED_REWARD;
  const closedType = mod.AdEventType.CLOSED;
  const errorType = mod.AdEventType.ERROR;

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
    loadFailure = 'error';
  };

  const classifyLoadError = (err: unknown): RewardedAdUiState => {
    const msg = String((err as { message?: string; code?: string | number })?.message
      ?? (err as { code?: string | number })?.code
      ?? err
      ?? '');
    if (/fill|no.?fill|ERROR_CODE_NO_FILL|\b3\b/i.test(msg)) return 'no_fill';
    if (/network|offline|timeout/i.test(msg)) return 'network_error';
    return 'error';
  };

  return {
    async load(sessionRef: string) {
      dispose();
      emit('loading');
      const unitId = rewardedAdUnitForPlatform(platform);
      try {
        // SSV custom data MUST be on createForAdRequest options (package API).
        ad = mod.RewardedAd.createForAdRequest(unitId, {
          serverSideVerificationOptions: {
            customData: sessionRef,
          },
        });

        // Load phase: only LOADED / ERROR. Earn/close listeners are registered in show()
        // once to avoid double onState + double verify poll.
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
              loadFailure = classifyLoadError(err);
              emit(loadFailure);
              reject(err instanceof Error ? err : new Error(String(err ?? loadFailure)));
            }),
          );
          ad!.load();
        });
        return loaded ? 'ready' : loadFailure;
      } catch {
        return loadFailure;
      }
    },
    async show() {
      if (!ad || !loaded) {
        emit('error');
        return 'error';
      }
      emit('showing');
      // Package show() resolves when the ad is *presented*, not when it closes.
      // Wait for EARNED_REWARD and/or CLOSED. If CLOSED races ahead of EARNED,
      // keep a short grace so late reward events still count as verifying.
      const CLOSED_EARNED_GRACE_MS = 2000;
      return new Promise<RewardedAdUiState>((resolve) => {
        let settled = false;
        let closedGraceTimer: ReturnType<typeof setTimeout> | null = null;
        const finish = (state: RewardedAdUiState) => {
          if (settled) return;
          settled = true;
          if (closedGraceTimer) {
            clearTimeout(closedGraceTimer);
            closedGraceTimer = null;
          }
          if (state !== 'showing') emit(state);
          resolve(state);
        };

        unsubs.push(
          ad!.addAdEventListener(earnedType, () => {
            earned = true;
            // Client reward → verifying UI; SSV still required for credit.
            finish('verifying');
          }),
        );
        unsubs.push(
          ad!.addAdEventListener(closedType, () => {
            if (earned) {
              finish('verifying');
              return;
            }
            // CLOSED-before-EARNED race: wait briefly before dismiss.
            if (closedGraceTimer) return;
            closedGraceTimer = setTimeout(() => {
              finish(earned ? 'verifying' : 'dismissed');
            }, CLOSED_EARNED_GRACE_MS);
          }),
        );
        unsubs.push(
          ad!.addAdEventListener(errorType, (err: unknown) => {
            finish(classifyLoadError(err) === 'network_error' ? 'network_error' : 'error');
          }),
        );

        void ad!.show().catch(() => {
          finish('error');
        });
      });
    },
    dispose,
  };
}

/** Test helper: clear module cache. */
export function __resetRewardedAdsForTests(): void {
  cachedModule = undefined;
  initPromise = null;
}
