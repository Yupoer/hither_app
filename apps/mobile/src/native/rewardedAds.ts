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
import { tailId, truncateDiagText } from '../utils/diagText';

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

export type StoreAdDebugStep = {
  step: string;
  phase: string;
  status?: string;
  success?: boolean;
  reason?: string;
  modulePresent?: boolean;
  bridgeReady?: boolean;
  canRequestAds?: boolean;
  consentFormShown?: boolean;
  unitMode?: string;
  unitSuffix?: string;
  sessionTail?: string;
  errCode?: string;
  errMsg?: string;
  platform?: string;
};

export type StoreAdDebugHandler = (step: StoreAdDebugStep) => void;

type AdRequestOptions = {
  requestNonPersonalizedAdsOnly?: boolean;
  serverSideVerificationOptions?: {
    customData?: string;
    userId?: string;
  };
};

type MobileAdsFactory = () => { initialize: () => Promise<unknown> };

type MobileAdsModule = {
  /** v15 style — lowercase. */
  mobileAds?: MobileAdsFactory;
  /** v16+ named export (actual package API). */
  MobileAds?: MobileAdsFactory;
  /** v16 default export is the same factory. */
  default?: MobileAdsFactory;
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
  AdsConsent?: AdsConsentModule['AdsConsent'];
};

/** Resolve MobileAds factory across v15 (`mobileAds`) and v16 (`MobileAds` / default). */
export function resolveMobileAdsFactory(mod: MobileAdsModule | null): MobileAdsFactory | null {
  if (!mod) return null;
  if (typeof mod.MobileAds === 'function') return mod.MobileAds;
  if (typeof mod.mobileAds === 'function') return mod.mobileAds;
  if (typeof mod.default === 'function') return mod.default;
  return null;
}

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
  return loadModule()?.AdsConsent ?? null;
}

function errParts(err: unknown): { errCode?: string; errMsg?: string } {
  const e = err as { message?: string; code?: string | number } | null;
  const code = e?.code != null ? String(e.code) : undefined;
  const msg = e?.message != null ? truncateDiagText(e.message, 120) : truncateDiagText(err, 120);
  return {
    errCode: code ? truncateDiagText(code, 40) : undefined,
    errMsg: msg || undefined,
  };
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
export async function ensureRewardedAdsReady(
  onDebug?: StoreAdDebugHandler,
): Promise<RewardedAdsAvailability> {
  const dbg = (step: StoreAdDebugStep) => {
    try {
      onDebug?.(step);
    } catch {
      /* never block ad path on logging */
    }
  };
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'other';

  // Do not cache a previous failure forever when a debug handler is attached —
  // field diagnosis needs a fresh probe each tap. Success still reuses initPromise.
  if (initPromise && !onDebug) return initPromise;

  const run = (async (): Promise<RewardedAdsAvailability> => {
    dbg({
      step: 'platform_check',
      phase: 'preflight',
      platform,
      status: platform,
    });
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      dbg({
        step: 'platform_check',
        phase: 'terminal',
        platform,
        success: false,
        status: 'unsupported',
        reason: 'unsupported',
      });
      return { available: false, reason: 'unsupported' as const };
    }

    let mod: MobileAdsModule | null = null;
    let requireErr: string | undefined;
    try {
      mod = loadModule();
    } catch (e) {
      requireErr = truncateDiagText(e, 120);
      mod = null;
    }
    const modulePresent = mod != null;
    const adsFactory = resolveMobileAdsFactory(mod);
    const bridgeReady = Boolean(adsFactory && mod?.RewardedAd);
    dbg({
      step: 'require_module',
      phase: 'preflight',
      platform,
      modulePresent,
      bridgeReady,
      success: modulePresent,
      errMsg: requireErr,
      status: modulePresent ? 'present' : 'absent',
    });
    dbg({
      step: 'probe_exports',
      phase: 'preflight',
      platform,
      modulePresent,
      bridgeReady,
      status: [
        mod?.MobileAds ? 'MobileAds' : null,
        mod?.mobileAds ? 'mobileAds' : null,
        mod?.default ? 'default' : null,
        mod?.RewardedAd ? 'RewardedAd' : null,
        mod?.AdsConsent ? 'AdsConsent' : null,
        mod?.RewardedAdEventType?.LOADED ? 'LOADED' : null,
        mod?.AdEventType?.ERROR ? 'ERROR' : null,
      ]
        .filter(Boolean)
        .join(','),
    });
    if (!adsFactory || !mod?.RewardedAd) {
      dbg({
        step: 'missing_module',
        phase: 'terminal',
        platform,
        modulePresent,
        bridgeReady,
        success: false,
        status: 'missing_module',
        reason: 'missing_module',
        errMsg: requireErr ?? (modulePresent && !adsFactory
          ? 'MobileAds_factory_missing'
          : undefined),
      });
      return { available: false, reason: 'missing_module' as const };
    }
    try {
      const consent = loadConsent();
      let canRequestAds = false;
      let consentFormShown = false;
      if (consent?.requestInfoUpdate) {
        dbg({
          step: 'consent_requestInfoUpdate_start',
          phase: 'preflight',
          platform,
          modulePresent: true,
          bridgeReady: true,
        });
        try {
          const info = await consent.requestInfoUpdate();
          canRequestAds = info.canRequestAds === true;
          dbg({
            step: 'consent_requestInfoUpdate_end',
            phase: 'preflight',
            platform,
            canRequestAds,
            status: info.isConsentFormAvailable ? 'form_available' : 'no_form',
            success: true,
          });
          if (info.isConsentFormAvailable && consent.loadAndShowConsentFormIfRequired) {
            consentFormShown = true;
            dbg({
              step: 'consent_form_start',
              phase: 'preflight',
              platform,
              consentFormShown: true,
            });
            const afterForm = await consent.loadAndShowConsentFormIfRequired();
            if (typeof afterForm?.canRequestAds === 'boolean') {
              canRequestAds = afterForm.canRequestAds === true;
            }
            dbg({
              step: 'consent_form_end',
              phase: 'preflight',
              platform,
              canRequestAds,
              consentFormShown: true,
              success: true,
            });
          }
        } catch (e) {
          const parts = errParts(e);
          dbg({
            step: 'consent_requestInfoUpdate_error',
            phase: 'preflight',
            platform,
            success: false,
            status: 'ump_update_failed',
            ...parts,
          });
        }
      } else {
        dbg({
          step: 'consent_api_missing',
          phase: 'preflight',
          platform,
          status: consent ? 'no_requestInfoUpdate' : 'no_AdsConsent',
        });
      }
      if (!canRequestAds && consent?.getConsentInfo) {
        dbg({
          step: 'consent_getConsentInfo_start',
          phase: 'preflight',
          platform,
        });
        try {
          const cached = await consent.getConsentInfo();
          canRequestAds = cached.canRequestAds === true;
          dbg({
            step: 'consent_getConsentInfo_end',
            phase: 'preflight',
            platform,
            canRequestAds,
            success: true,
          });
        } catch (e) {
          const parts = errParts(e);
          dbg({
            step: 'consent_getConsentInfo_error',
            phase: 'preflight',
            platform,
            success: false,
            ...parts,
          });
        }
      }
      if (!canRequestAds) {
        initPromise = null;
        dbg({
          step: 'consent_blocked',
          phase: 'terminal',
          platform,
          canRequestAds: false,
          consentFormShown,
          success: false,
          status: 'consent_required',
          reason: 'consent_required',
        });
        return { available: false, reason: 'consent_required' as const };
      }
      dbg({
        step: 'mobile_ads_initialize_start',
        phase: 'ready',
        platform,
        canRequestAds: true,
      });
      await adsFactory().initialize();
      dbg({
        step: 'mobile_ads_initialize_end',
        phase: 'ready',
        platform,
        canRequestAds: true,
        success: true,
        status: 'ready',
      });
      dbg({
        step: 'ready_true',
        phase: 'ready',
        platform,
        modulePresent: true,
        bridgeReady: true,
        canRequestAds: true,
        success: true,
        status: 'available',
      });
      return { available: true as const };
    } catch (e) {
      initPromise = null;
      const parts = errParts(e);
      dbg({
        step: 'init_failed',
        phase: 'terminal',
        platform,
        success: false,
        status: 'init_failed',
        reason: 'init_failed',
        ...parts,
      });
      return { available: false, reason: 'init_failed' as const };
    }
  })();

  if (!onDebug) {
    initPromise = run;
  }
  return run;
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
    onDebug?: StoreAdDebugHandler;
  },
): RewardedAdController | null {
  const mod = loadModule();
  const dbg = (step: StoreAdDebugStep) => {
    try {
      handlers?.onDebug?.(step);
    } catch {
      /* ignore */
    }
  };
  if (!mod?.RewardedAd) {
    dbg({
      step: 'controller_null',
      phase: 'terminal',
      platform,
      modulePresent: mod != null,
      bridgeReady: false,
      success: false,
      status: 'missing_module',
      reason: 'missing_module',
    });
    return null;
  }

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

  const unitMode = productionAdUnitsEnabled() ? 'production' : 'test';
  const unitId = rewardedAdUnitForPlatform(platform);
  const unitSuffix = tailId(unitId, 6);

  dbg({
    step: 'controller_create',
    phase: 'load',
    platform,
    unitMode,
    unitSuffix,
    modulePresent: true,
    bridgeReady: true,
    success: true,
  });

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
    dbg({
      step: 'dispose',
      phase: 'terminal',
      platform,
      unitMode,
      unitSuffix,
      status: 'dispose',
    });
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
      const sessionTail = tailId(sessionRef, 8);
      dbg({
        step: 'ad_load_start',
        phase: 'load',
        platform,
        unitMode,
        unitSuffix,
        sessionTail,
        status: 'loading',
      });
      try {
        ad = mod.RewardedAd.createForAdRequest(unitId, {
          serverSideVerificationOptions: {
            customData: sessionRef,
          },
        });
        dbg({
          step: 'ad_create_request',
          phase: 'load',
          platform,
          unitMode,
          unitSuffix,
          sessionTail,
          success: true,
        });

        const loadState = await new Promise<RewardedAdUiState>((resolve) => {
          let done = false;
          const finishLoad = (state: RewardedAdUiState) => {
            if (done) return;
            done = true;
            pendingSettle = null;
            clearPhaseTimeout();
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
            dbg({
              step: 'ad_load_timeout',
              phase: 'terminal',
              platform,
              unitMode,
              unitSuffix,
              sessionTail,
              success: false,
              status: 'timeout',
              reason: 'load_timeout',
            });
            emit('error', gen);
            finishLoad('error');
          }, REWARDED_AD_LOAD_TIMEOUT_MS);
          unsubs.push(
            ad.addAdEventListener(loadedType, () => {
              if (done || disposed || gen !== generation || phase !== 'load') return;
              loaded = true;
              dbg({
                step: 'ad_loaded',
                phase: 'load',
                platform,
                unitMode,
                unitSuffix,
                sessionTail,
                success: true,
                status: 'ready',
              });
              emit('ready', gen);
              finishLoad('ready');
            }),
          );
          unsubs.push(
            ad.addAdEventListener(errorType, (err: unknown) => {
              if (done || disposed || gen !== generation || phase !== 'load') return;
              loadFailure = classifyLoadError(err);
              const parts = errParts(err);
              dbg({
                step: 'ad_load_error',
                phase: 'terminal',
                platform,
                unitMode,
                unitSuffix,
                sessionTail,
                success: false,
                status: loadFailure,
                reason: loadFailure,
                ...parts,
              });
              emit(loadFailure, gen);
              finishLoad(loadFailure);
            }),
          );
          dbg({
            step: 'ad_load_call',
            phase: 'load',
            platform,
            unitMode,
            unitSuffix,
            sessionTail,
          });
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
      } catch (e) {
        const fail = loadFailure;
        const parts = errParts(e);
        dbg({
          step: 'ad_load_throw',
          phase: 'terminal',
          platform,
          unitMode,
          unitSuffix,
          success: false,
          status: fail,
          reason: fail,
          ...parts,
        });
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
        dbg({
          step: 'ad_show_not_ready',
          phase: 'terminal',
          platform,
          unitMode,
          unitSuffix,
          success: false,
          status: 'error',
          reason: !ad ? 'no_ad' : !loaded ? 'not_loaded' : 'disposed',
        });
        emit('error', generation);
        return 'error';
      }
      const gen = generation;
      phase = 'show';
      emit('showing', gen);
      dbg({
        step: 'ad_show_start',
        phase: 'show',
        platform,
        unitMode,
        unitSuffix,
        status: 'showing',
      });
      return new Promise<RewardedAdUiState>((resolve) => {
        let settled = false;
        const finish = (state: RewardedAdUiState) => {
          if (settled) return;
          settled = true;
          pendingSettle = null;
          clearGraceTimer();
          clearPhaseTimeout();
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
          dbg({
            step: 'ad_show_timeout',
            phase: 'terminal',
            platform,
            unitMode,
            unitSuffix,
            success: false,
            status: 'timeout',
            reason: 'show_timeout',
          });
          finish('error');
        }, REWARDED_AD_SHOW_TIMEOUT_MS);

        unsubs.push(
          ad!.addAdEventListener(earnedType, () => {
            if (settled || disposed || gen !== generation || phase !== 'show') return;
            earned = true;
            dbg({
              step: 'ad_earned',
              phase: 'verify',
              platform,
              unitMode,
              unitSuffix,
              success: true,
              status: 'verifying',
            });
            finish('verifying');
          }),
        );
        unsubs.push(
          ad!.addAdEventListener(closedType, () => {
            if (settled || disposed || gen !== generation || phase !== 'show') return;
            dbg({
              step: 'ad_closed',
              phase: 'show',
              platform,
              unitMode,
              unitSuffix,
              status: earned ? 'closed_after_earn' : 'closed_before_earn',
            });
            if (earned) {
              finish('verifying');
              return;
            }
            if (closedGraceTimer) return;
            closedGraceTimer = setTimeout(() => {
              dbg({
                step: earned ? 'ad_closed_verifying' : 'ad_dismissed',
                phase: earned ? 'verify' : 'terminal',
                platform,
                unitMode,
                unitSuffix,
                success: earned,
                status: earned ? 'verifying' : 'dismissed',
              });
              finish(earned ? 'verifying' : 'dismissed');
            }, REWARDED_AD_CLOSED_EARNED_GRACE_MS);
          }),
        );
        unsubs.push(
          ad!.addAdEventListener(errorType, (err: unknown) => {
            if (settled || disposed || gen !== generation || phase !== 'show') return;
            const classified = classifyLoadError(err) === 'network_error' ? 'network_error' : 'error';
            const parts = errParts(err);
            dbg({
              step: 'ad_show_error',
              phase: 'terminal',
              platform,
              unitMode,
              unitSuffix,
              success: false,
              status: classified,
              reason: classified,
              ...parts,
            });
            finish(classified);
          }),
        );

        void ad!.show().catch((e: unknown) => {
          const parts = errParts(e);
          dbg({
            step: 'ad_show_promise_reject',
            phase: 'terminal',
            platform,
            unitMode,
            unitSuffix,
            success: false,
            status: 'error',
            ...parts,
          });
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
