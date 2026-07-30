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

/** Max wait for LOADED/ERROR after load() — prevents permanent CTA hang. */
export const REWARDED_AD_LOAD_TIMEOUT_MS = 45_000;
/** Max wait for EARNED/CLOSED/ERROR after show() starts. */
export const REWARDED_AD_SHOW_TIMEOUT_MS = 120_000;
/** CLOSED-before-EARNED grace before treating as dismiss. */
export const REWARDED_AD_CLOSED_EARNED_GRACE_MS = 2_000;

/**
 * Create a one-shot rewarded ad controller bound to a session ref (SSV custom data).
 * EARNED_REWARD → 'verifying' only (never mutates wallet).
 * show() resolves from ad events (CLOSED / EARNED_REWARD), not from the show() Promise.
 *
 * Load-phase LOADED/ERROR listeners are detached as soon as load settles so a late
 * SDK ERROR cannot demote UI after EARNED_REWARD. dispose() always settles any
 * in-flight load/show Promise so callers never hang.
 * Finite load/show timeouts always settle so CTA can retry (Ticket 03).
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
  let disposed = false;
  let generation = 0;
  let loadFailure: RewardedAdUiState = 'error';
  let closedGraceTimer: ReturnType<typeof setTimeout> | null = null;
  let phaseTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  /** Settles the active load()/show() Promise exactly once (including dispose). */
  let pendingSettle: ((state: RewardedAdUiState) => void) | null = null;
  /** 'load' | 'show' gates which ERROR path may emit / finish. */
  let phase: 'idle' | 'load' | 'show' = 'idle';

  const loadedType = mod.RewardedAdEventType.LOADED;
  const earnedType = mod.RewardedAdEventType.EARNED_REWARD;
  const closedType = mod.AdEventType.CLOSED;
  const errorType = mod.AdEventType.ERROR;

  const emit = (state: RewardedAdUiState, gen: number) => {
    if (disposed || gen !== generation) return;
    handlers?.onState?.(state);
  };

  const clearGraceTimer = () => {
    if (closedGraceTimer) {
      clearTimeout(closedGraceTimer);
      closedGraceTimer = null;
    }
  };

  const clearPhaseTimeout = () => {
    if (phaseTimeoutTimer) {
      clearTimeout(phaseTimeoutTimer);
      phaseTimeoutTimer = null;
    }
  };

  const clearUnsubs = () => {
    for (const u of unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    unsubs = [];
  };

  /** Resolve in-flight load/show once; always clears timers first. */
  const settlePending = (state: RewardedAdUiState) => {
    clearGraceTimer();
    clearPhaseTimeout();
    const settle = pendingSettle;
    pendingSettle = null;
    if (settle) settle(state);
  };

  const dispose = () => {
    disposed = true;
    generation += 1;
    phase = 'idle';
    // Unblock any awaiting load()/show() so unmount / retry never hangs.
    settlePending('error');
    clearUnsubs();
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
      disposed = false;
      const gen = generation;
      phase = 'load';
      loadFailure = 'error';
      earned = false;
      loaded = false;
      emit('loading', gen);
      const unitId = rewardedAdUnitForPlatform(platform);
      try {
        ad = mod.RewardedAd.createForAdRequest(unitId, {
          serverSideVerificationOptions: {
            customData: sessionRef,
          },
        });

        // Load phase: only LOADED / ERROR. Detach both as soon as load settles
        // so they cannot fire into show() and demote verifying UI.
        const loadState = await new Promise<RewardedAdUiState>((resolve) => {
          let done = false;
          const finishLoad = (state: RewardedAdUiState) => {
            if (done) return;
            done = true;
            pendingSettle = null;
            clearPhaseTimeout();
            // Drop load listeners immediately (even before resolve continues).
            clearUnsubs();
            resolve(state);
          };
          pendingSettle = finishLoad;

          if (disposed || gen !== generation || !ad) {
            finishLoad('error');
            return;
          }
          phaseTimeoutTimer = setTimeout(() => {
            if (done || disposed || gen !== generation || phase !== 'load') return;
            loadFailure = 'error';
            emit('error', gen);
            finishLoad('error');
          }, REWARDED_AD_LOAD_TIMEOUT_MS);
          unsubs.push(
            ad.addAdEventListener(loadedType, () => {
              if (done || disposed || gen !== generation || phase !== 'load') return;
              loaded = true;
              emit('ready', gen);
              finishLoad('ready');
            }),
          );
          unsubs.push(
            ad.addAdEventListener(errorType, (err: unknown) => {
              if (done || disposed || gen !== generation || phase !== 'load') return;
              loadFailure = classifyLoadError(err);
              emit(loadFailure, gen);
              finishLoad(loadFailure);
            }),
          );
          ad.load();
        });

        if (disposed || gen !== generation) return 'error';
        if (loadState === 'ready') {
          phase = 'idle';
          return 'ready';
        }
        ad = null;
        loaded = false;
        phase = 'idle';
        return loadState;
      } catch {
        const fail = loadFailure;
        settlePending(fail);
        clearUnsubs();
        ad = null;
        loaded = false;
        phase = 'idle';
        return fail;
      }
    },
    async show() {
      if (!ad || !loaded || disposed) {
        emit('error', generation);
        return 'error';
      }
      const gen = generation;
      phase = 'show';
      emit('showing', gen);
      // Package show() resolves when the ad is *presented*, not when it closes.
      // Wait for EARNED_REWARD and/or CLOSED. If CLOSED races ahead of EARNED,
      // keep a short grace so late reward events still count as verifying.
      return new Promise<RewardedAdUiState>((resolve) => {
        let settled = false;
        const finish = (state: RewardedAdUiState) => {
          if (settled) return;
          settled = true;
          pendingSettle = null;
          clearGraceTimer();
          clearPhaseTimeout();
          // Detach show listeners so late ERROR cannot emit after settle.
          clearUnsubs();
          phase = 'idle';
          if (disposed || gen !== generation) {
            resolve(state);
            return;
          }
          if (state !== 'showing') emit(state, gen);
          resolve(state);
        };
        pendingSettle = finish;

        phaseTimeoutTimer = setTimeout(() => {
          if (settled || disposed || gen !== generation || phase !== 'show') return;
          finish('error');
        }, REWARDED_AD_SHOW_TIMEOUT_MS);

        unsubs.push(
          ad!.addAdEventListener(earnedType, () => {
            if (settled || disposed || gen !== generation || phase !== 'show') return;
            earned = true;
            // Client reward → verifying UI; SSV still required for credit.
            finish('verifying');
          }),
        );
        unsubs.push(
          ad!.addAdEventListener(closedType, () => {
            if (settled || disposed || gen !== generation || phase !== 'show') return;
            if (earned) {
              finish('verifying');
              return;
            }
            // CLOSED-before-EARNED race: wait briefly before dismiss.
            if (closedGraceTimer) return;
            closedGraceTimer = setTimeout(() => {
              finish(earned ? 'verifying' : 'dismissed');
            }, REWARDED_AD_CLOSED_EARNED_GRACE_MS);
          }),
        );
        unsubs.push(
          ad!.addAdEventListener(errorType, (err: unknown) => {
            if (settled || disposed || gen !== generation || phase !== 'show') return;
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

/** Test helper: inject a fake GMA module (or null). */
export function __setMobileAdsModuleForTests(mod: MobileAdsModule | null | undefined): void {
  cachedModule = mod;
  initPromise = null;
}
