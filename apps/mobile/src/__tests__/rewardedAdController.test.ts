/**
 * Behavioral unit tests for createRewardedAdController (Ticket 03).
 * Uses an injected fake GMA module — no native ads.
 */
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import {
  __resetRewardedAdsForTests,
  __setMobileAdsModuleForTests,
  createRewardedAdController,
  ensureRewardedAdsReady,
  REWARDED_AD_LOAD_TIMEOUT_MS,
  REWARDED_AD_SHOW_TIMEOUT_MS,
} from '../native/rewardedAds';
import type { RewardedAdUiState } from '../store/types';

type Handler = (...args: unknown[]) => void;

function makeFakeAd() {
  const listeners = new Map<string, Handler[]>();
  const ad = {
    addAdEventListener: (event: string, handler: Handler) => {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return () => {
        const next = (listeners.get(event) ?? []).filter((h) => h !== handler);
        listeners.set(event, next);
      };
    },
    load: jest.fn(() => {
      // default: fire LOADED async
      queueMicrotask(() => {
        for (const h of listeners.get('LOADED') ?? []) h();
      });
    }),
    show: jest.fn(async () => undefined),
    emit: (event: string, ...args: unknown[]) => {
      for (const h of [...(listeners.get(event) ?? [])]) h(...args);
    },
    listenerCount: (event: string) => (listeners.get(event) ?? []).length,
  };
  return ad;
}

function installFakeModule(adFactory: () => ReturnType<typeof makeFakeAd>) {
  __setMobileAdsModuleForTests({
    mobileAds: () => ({ initialize: async () => ({}) }),
    RewardedAd: {
      createForAdRequest: () => adFactory() as never,
    },
    RewardedAdEventType: {
      LOADED: 'LOADED',
      EARNED_REWARD: 'EARNED_REWARD',
    },
    AdEventType: {
      CLOSED: 'CLOSED',
      ERROR: 'ERROR',
    },
  });
}

beforeEach(() => {
  __resetRewardedAdsForTests();
});

afterEach(() => {
  __resetRewardedAdsForTests();
});

describe('createRewardedAdController', () => {
  it('uses cached consent when the UMP refresh request fails', async () => {
    const initialize = jest.fn(async () => ({}));
    __setMobileAdsModuleForTests({
      mobileAds: () => ({ initialize }),
      RewardedAd: {
        createForAdRequest: () => makeFakeAd() as never,
      },
      RewardedAdEventType: {
        LOADED: 'LOADED',
        EARNED_REWARD: 'EARNED_REWARD',
      },
      AdEventType: {
        CLOSED: 'CLOSED',
        ERROR: 'ERROR',
      },
      AdsConsent: {
        requestInfoUpdate: jest.fn(async () => {
          throw new Error('temporary UMP network failure');
        }),
        loadAndShowConsentFormIfRequired: jest.fn(async () => ({ canRequestAds: false })),
        getConsentInfo: jest.fn(async () => ({ canRequestAds: true })),
      },
    });

    await expect(ensureRewardedAdsReady()).resolves.toEqual({ available: true });
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('emits debug steps for missing native module', async () => {
    __setMobileAdsModuleForTests(null);
    const steps: string[] = [];
    const result = await ensureRewardedAdsReady((d) => {
      steps.push(d.step);
    });
    expect(result).toEqual({ available: false, reason: 'missing_module' });
    expect(steps).toContain('require_module');
    expect(steps).toContain('missing_module');
  });

  it('emits load debug steps on happy path', async () => {
    const ad = makeFakeAd();
    installFakeModule(() => ad);
    // consent open
    __setMobileAdsModuleForTests({
      mobileAds: () => ({ initialize: async () => ({}) }),
      RewardedAd: {
        createForAdRequest: () => ad as never,
      },
      RewardedAdEventType: {
        LOADED: 'LOADED',
        EARNED_REWARD: 'EARNED_REWARD',
      },
      AdEventType: {
        CLOSED: 'CLOSED',
        ERROR: 'ERROR',
      },
      AdsConsent: {
        requestInfoUpdate: jest.fn(async () => ({ canRequestAds: true })),
        loadAndShowConsentFormIfRequired: jest.fn(async () => ({ canRequestAds: true })),
      },
    });
    const steps: string[] = [];
    await ensureRewardedAdsReady((d) => steps.push(d.step));
    const ctrl = createRewardedAdController('ios', {
      onDebug: (d) => steps.push(d.step),
    });
    expect(ctrl).not.toBeNull();
    await expect(ctrl!.load('sess-abc')).resolves.toBe('ready');
    expect(steps).toEqual(expect.arrayContaining([
      'ready_true',
      'controller_create',
      'ad_load_start',
      'ad_loaded',
    ]));
  });

  it('returns null when native module is missing', () => {
    __setMobileAdsModuleForTests(null);
    expect(createRewardedAdController('ios')).toBeNull();
  });

  it('detaches load ERROR so late ERROR after ready cannot demote show verifying', async () => {
    const ad = makeFakeAd();
    installFakeModule(() => ad);
    const states: RewardedAdUiState[] = [];
    const ctrl = createRewardedAdController('ios', {
      onState: (s) => { states.push(s); },
    });
    expect(ctrl).not.toBeNull();

    const loadP = ctrl!.load('session-1');
    await loadP;
    expect(states).toContain('ready');
    // Load listeners must be gone after successful load.
    expect(ad.listenerCount('LOADED')).toBe(0);
    expect(ad.listenerCount('ERROR')).toBe(0);

    const showP = ctrl!.show();
    // Earn first → verifying
    ad.emit('EARNED_REWARD', { type: 'reward', amount: 1 });
    // Late ERROR must not rewrite verifying via load-phase or unsubs.
    ad.emit('ERROR', { message: 'ERROR_CODE_NO_FILL', code: 3 });
    const showState = await showP;
    expect(showState).toBe('verifying');
    // Last UI-relevant state from controller should still be verifying (not no_fill).
    expect(states.filter((s) => s === 'verifying').length).toBeGreaterThanOrEqual(1);
    expect(states[states.length - 1]).toBe('verifying');
  });

  it('dispose settles in-flight show so Promise does not hang', async () => {
    const ad = makeFakeAd();
    // Do not auto-fire LOADED; control sequence.
    ad.load = jest.fn();
    installFakeModule(() => ad);
    const ctrl = createRewardedAdController('android');
    const loadP = ctrl!.load('session-2');
    ad.emit('LOADED');
    await expect(loadP).resolves.toBe('ready');

    const showP = ctrl!.show();
    // Dispose mid-show (e.g. unmount) must settle.
    ctrl!.dispose();
    await expect(showP).resolves.toBe('error');
  });

  it('dispose settles in-flight load', async () => {
    const ad = makeFakeAd();
    ad.load = jest.fn(); // never emits
    installFakeModule(() => ad);
    const ctrl = createRewardedAdController('ios');
    const loadP = ctrl!.load('session-3');
    ctrl!.dispose();
    await expect(loadP).resolves.toBe('error');
  });

  it('maps no-fill load errors', async () => {
    const ad = makeFakeAd();
    ad.load = jest.fn(() => {
      queueMicrotask(() => {
        ad.emit('ERROR', { message: 'ERROR_CODE_NO_FILL', code: 3 });
      });
    });
    installFakeModule(() => ad);
    const ctrl = createRewardedAdController('ios');
    await expect(ctrl!.load('s')).resolves.toBe('no_fill');
  });

  it('returns dismissed when closed without earn (after grace)', async () => {
    const ad = makeFakeAd();
    installFakeModule(() => ad);
    const ctrl = createRewardedAdController('ios');
    await ctrl!.load('s');
    jest.useFakeTimers();
    try {
      const showP = ctrl!.show();
      ad.emit('CLOSED');
      await jest.advanceTimersByTimeAsync(2100);
      await expect(showP).resolves.toBe('dismissed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('load times out when SDK never emits LOADED/ERROR', async () => {
    const ad = makeFakeAd();
    ad.load = jest.fn(); // never emits
    installFakeModule(() => ad);
    const ctrl = createRewardedAdController('ios');
    jest.useFakeTimers();
    try {
      const loadP = ctrl!.load('timeout-load');
      await jest.advanceTimersByTimeAsync(REWARDED_AD_LOAD_TIMEOUT_MS + 50);
      await expect(loadP).resolves.toBe('error');
    } finally {
      jest.useRealTimers();
    }
  });

  it('show times out when SDK never emits EARNED/CLOSED/ERROR', async () => {
    const ad = makeFakeAd();
    installFakeModule(() => ad);
    const ctrl = createRewardedAdController('ios');
    await ctrl!.load('timeout-show');
    jest.useFakeTimers();
    try {
      const showP = ctrl!.show();
      // show() is presented but no closed/earned/error
      await jest.advanceTimersByTimeAsync(REWARDED_AD_SHOW_TIMEOUT_MS + 50);
      await expect(showP).resolves.toBe('error');
    } finally {
      jest.useRealTimers();
    }
  });
});
