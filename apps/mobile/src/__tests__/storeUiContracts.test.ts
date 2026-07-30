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
  it('declares members route tools store options with viewport of 3', () => {
    expect(mapScreen).toContain("key: 'store'");
    expect(mapScreen).toContain("t('map.tabStore')");
    expect(mapScreen).toContain('viewportCount={3}');
    expect(mapScreen).toContain('sheetPane === \'store\'');
    expect(mapScreen).toContain('StorePane');
    expect(mapScreen).toContain('sheet-pane-swipe-area');
    expect(mapScreen).toContain('paneAfterSwipe');
    expect(mapScreen).toContain('isHorizontalPaneGesture');
    expect(mapScreen).toContain('editButtonActive');
  });

  it('Segmented supports scrollable 3-slot viewport and a11y', () => {
    expect(segmented).toContain('viewportCount');
    expect(segmented).toContain('tabScrollOffsetForSelection');
    expect(segmented).toContain('segmented-viewport');
    expect(segmented).toContain('accessibilityState={{ selected: active, disabled: locked }}');
    expect(segmented).toContain('widthAppeared');
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

  it('fails reward session on no-fill immediately; dismiss uses grace before fail', () => {
    expect(storePane).toContain('updateRewardSessionStatus');
    expect(storePane).toContain("updateRewardSessionStatus(sessionRef, 'failed')");
    expect(storePane).toContain("updateRewardSessionStatus(sessionRef, 'verifying')");
    expect(storePane).toContain('DISMISS_FAIL_GRACE_MS');
    expect(storePane).toContain('clearDismissFailTimer');
    // Load/no-fill still fails immediately.
    expect(storePane).toContain('Immediate fail for no-fill');
    expect(storePane).toContain('store-offline-banner');
    expect(storePane).toContain('store.offlineBody');
    expect(storePane).toContain('refreshConnectivity');
    expect(storePane).toContain('getConnectivitySnapshot');
  });

  it('rewardedAds show waits briefly for late EARNED_REWARD after close', () => {
    expect(rewardedAds).toContain('CLOSED before EARNED_REWARD');
    expect(rewardedAds).toContain('setTimeout(r, 900)');
  });

  it('pre-checks open destinations with credits before paywall', () => {
    expect(mapScreen).toContain('countOpenDestinations');
    expect(mapScreen).toContain('shouldBlockNewDestination');
    expect(mapScreen).toContain('extraCredits: extraPointCredits');
  });

  it('rewarded ads degrade without native module and use test units in dev', () => {
    expect(rewardedAds).toContain('missing_module');
    expect(rewardedAds).toContain('ADMOB_TEST_REWARDED_UNITS');
    expect(rewardedAds).toContain('setServerSideVerificationOptions');
    expect(rewardedAds).toContain("emit('verifying')");
    expect(rewardedAds).not.toContain('redeemStoreProduct');
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
