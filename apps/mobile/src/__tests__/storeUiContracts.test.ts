/**
 * Four-pane store UI contracts (source-level, same style as mapUiContracts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (rel: string) =>
  readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const mapScreen = read('screens/MapScreen.tsx');
const segmented = read('screens/MapScreen/components/Segmented.tsx');
const storePane = read('screens/MapScreen/components/StorePane.tsx');
const rewardedAds = read('native/rewardedAds.ts');
const i18n = read('i18n/index.ts');

describe('four-pane store navigation contracts', () => {
  it('declares members route tools store options with CoverFlow (all 4 visible)', () => {
    expect(mapScreen).toContain("key: 'store'");
    expect(mapScreen).toContain("t('map.tabStore')");
    expect(mapScreen).toContain('PaneCoverFlow');
    expect(mapScreen).toContain('sheetPane === \'store\'');
    expect(mapScreen).toContain('StorePane');
    expect(mapScreen).toContain('sheet-pane-content-area');
    expect(mapScreen).toContain('editButtonActive');
    // Raw content-area touch swipe removed — CoverFlow owns horizontal gesture.
    expect(mapScreen).not.toContain('sheet-pane-swipe-area');
    expect(mapScreen).not.toContain('viewportCount={3}');
  });

  it('CoverFlow is swipe-only with a11y adjustable and exclusive offsets', () => {
    const cover = read('screens/MapScreen/components/PaneCoverFlow.tsx');
    expect(cover).toContain('pane-coverflow');
    expect(cover).toContain('accessibilityRole="adjustable"');
    expect(cover).toContain('activeOffsetX');
    expect(cover).toContain('failOffsetY');
    expect(cover).toContain('selectionTick');
    expect(cover).toContain('useReducedMotion');
    expect(cover).not.toContain('arrow');
    expect(cover).not.toContain('pagination');
    // Settings still use Segmented (non-glass).
    expect(segmented).toContain('viewportCount');
    expect(segmented).toContain('accessibilityState={{ selected: active, disabled: locked }}');
  });

  it('Store pane shell has balance ad CTA and product sections', () => {
    expect(storePane).toContain('store-balance');
    expect(storePane).toContain('store-ad-cta');
    expect(storePane).toContain('store-anonymous-gate');
    expect(storePane).toContain('teamProducts');
    expect(storePane).toContain('personalProducts');
    expect(storePane).toContain('verifying');
    expect(storePane).toContain('createRewardSession');
    expect(storePane).toContain('redeemStoreProduct');
    // Client never credits wallet from ad callback.
    expect(storePane).not.toContain('balance + 1');
    expect(storePane).not.toContain('balance +1');
  });

  it('fails reward session on no-fill; verifying not client-failed; offline banner', () => {
    expect(storePane).toContain('updateRewardSessionStatus');
    expect(storePane).toContain("updateRewardSessionStatus(sessionRef, 'failed')");
    expect(storePane).toContain("updateRewardSessionStatus(sessionRef, 'verifying')");
    // Load/no-fill fails immediately via failSession; dismiss fails only if not verifying.
    expect(storePane).toContain("loadState !== 'ready'");
    expect(storePane).toContain('!verifyingRef.current');
    expect(storePane).toContain('store-offline-banner');
    expect(storePane).toContain('store.offlineBody');
    expect(storePane).toContain('refreshConnectivity');
    expect(storePane).toContain('getConnectivitySnapshot');
  });

  it('rewardedAds show resolves from CLOSED/EARNED events not present-start', () => {
    expect(rewardedAds).toContain('resolves when the ad is *presented*');
    expect(rewardedAds).toContain('Wait for EARNED_REWARD and/or CLOSED');
    expect(rewardedAds).toContain('serverSideVerificationOptions');
  });

  it('pre-checks open destinations with credits before paywall', () => {
    expect(mapScreen).toContain('countOpenDestinations');
    expect(mapScreen).toContain('shouldBlockNewDestination');
    expect(mapScreen).toContain('extraCredits: extraPointCredits');
  });

  it('rewarded ads degrade without native module and use test units in dev', () => {
    expect(rewardedAds).toContain('missing_module');
    expect(rewardedAds).toContain('ADMOB_TEST_REWARDED_UNITS');
    // SSV custom data on createForAdRequest options (not instance setter).
    expect(rewardedAds).toContain('serverSideVerificationOptions');
    expect(rewardedAds).toContain('customData: sessionRef');
    expect(rewardedAds).toContain('createForAdRequest(unitId,');
    expect(rewardedAds).toContain('canRequestAds');
    expect(rewardedAds).toContain("finish('verifying')");
    expect(rewardedAds).not.toContain('redeemStoreProduct');
  });

  it('store pane caches snapshot offline and re-enables CTA after verify poll', () => {
    expect(storePane).toContain('readCachedSnapshot');
    expect(storePane).toContain('writeCachedSnapshot');
    expect(storePane).toContain('snapshot.v2');
    expect(storePane).toContain('readPendingRedeem');
    expect(storePane).toContain('writePendingRedeem');
    expect(storePane).toContain('clientRequestKey');
    expect(storePane).toContain('VERIFY_POLL_TICKS');
    expect(storePane).toContain('startLateSsvPoll');
    expect(storePane).toContain("setAdState('idle')");
    expect(storePane).toContain('store-product-pinned');
    expect(storePane).toContain('setAccessibilityFocus');
  });

  it('rewardedAds consent fails closed and closed-before-earned grace', () => {
    expect(rewardedAds).toContain('let canRequestAds = false');
    expect(rewardedAds).toContain('CLOSED_EARNED_GRACE_MS');
    expect(rewardedAds).toContain('// Load phase: only LOADED / ERROR');
  });

  it('rewardedAds drops stale callbacks, settles dispose, and detaches load listeners', () => {
    expect(rewardedAds).toContain('gen !== generation');
    expect(rewardedAds).toContain('disposed');
    expect(rewardedAds).toContain('pendingSettle');
    expect(rewardedAds).toContain('settlePending');
    expect(rewardedAds).toContain("phase !== 'load'");
    expect(rewardedAds).toContain('clearUnsubs');
    expect(storePane).toContain('controller.dispose()');
    expect(storePane).toContain('controllerRef.current = null');
    // Client never writes wallet from reward path.
    expect(storePane).toContain('startVerifyPoll');
    expect(storePane).not.toContain('setSnapshot({ ...snapshot, balance:');
  });

  it('i18n includes store and tabStore keys in zh and en', () => {
    expect(i18n).toContain("'map.tabStore': '商店'");
    expect(i18n).toContain("'map.tabStore': 'Store'");
    expect(i18n).toContain("'store.adVerifying'");
    expect(i18n).toContain("'store.extraCreditsRemaining'");
  });

  it('tools pane locks Live Activity without entitlement and deep-links store', () => {
    expect(mapScreen).toContain('tools-live-activity-locked');
    expect(mapScreen).toContain('personal_live_activity_lifetime');
    expect(mapScreen).toContain('liveActivityAllowed');
    expect(mapScreen).toContain('liveActivityEffective');
    expect(mapScreen).toContain('openStoreForLiveActivity');
  });

  it('route pane shows extra credits only when > 0', () => {
    expect(mapScreen).toContain('extraPointCredits > 0');
    expect(mapScreen).toContain('route-extra-point-credits');
  });
});
