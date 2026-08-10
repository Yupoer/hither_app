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
const i18n = [read('i18n/locales/zh.ts'), read('i18n/locales/en.ts')].join('\n');

describe('four-pane store navigation contracts', () => {
  it('declares members route tools store options with icon tabs (all 4 visible)', () => {
    expect(mapScreen).toContain("key: 'store'");
    expect(mapScreen).toContain("t('map.tabStore')");
    expect(mapScreen).toContain('SheetPaneTabs');
    expect(mapScreen).not.toContain('PaneCoverFlow');
    expect(mapScreen).toContain('sheetPane === \'store\'');
    expect(mapScreen).toContain('StorePane');
    expect(mapScreen).toContain('sheet-pane-content-area');
    expect(mapScreen).toContain('editButtonActive');
    // Raw content-area touch swipe removed — tabs are tap-only.
    expect(mapScreen).not.toContain('sheet-pane-swipe-area');
    expect(mapScreen).not.toContain('viewportCount={3}');
  });

  it('SheetPaneTabs is tap icon bar with tab a11y', () => {
    const tabs = read('screens/MapScreen/components/SheetPaneTabs.tsx');
    expect(tabs).toContain('testID="sheet-pane-tabs"');
    expect(tabs).toContain('accessibilityRole="tab"');
    expect(tabs).toContain('selectionTick');
    expect(tabs).toContain('bag-handle');
    expect(tabs).not.toContain('arrow');
    expect(tabs).not.toContain('pagination');
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

  it('Store orders Premium then balance then ad and hides restore', () => {
    const premium = read('components/PremiumPresentation.tsx');
    const paywall = read('components/PaywallSheet.tsx');
    expect(storePane).toContain('PremiumPresentation');
    expect(storePane).toContain('store-premium-section');
    expect(storePane).toContain('showRestore={false}');
    expect(storePane).toContain('store-ad-cta');
    expect(storePane).toContain('store-premium-ad-divider');
    // Layout order: Premium → divider → balance → ad.
    const premiumIdx = storePane.indexOf('store-premium-section');
    const dividerIdx = storePane.indexOf('store-premium-ad-divider');
    const adIdx = storePane.indexOf('store-ad-cta');
    const balanceIdx = storePane.indexOf('store-balance');
    expect(premiumIdx).toBeGreaterThan(-1);
    expect(adIdx).toBeGreaterThan(-1);
    expect(balanceIdx).toBeGreaterThan(-1);
    expect(dividerIdx).toBeGreaterThan(premiumIdx);
    expect(premiumIdx).toBeLessThan(balanceIdx);
    expect(balanceIdx).toBeLessThan(adIdx);
    expect(dividerIdx).toBeLessThan(adIdx);
    // Shared presentation: restore gated by showRestore.
    expect(premium).toContain('showRestore');
    expect(premium).toContain('restorePremiumSubscription');
    expect(premium).toContain('purchasePremiumSubscription');
    expect(premium).toContain('loadPremiumStoreProducts');
    expect(paywall).toContain('showRestore');
    expect(paywall).not.toContain('showRestore={false}');
    expect(paywall).toContain('PremiumPresentation');
    // Store must not render its own restore CTA string/handler.
    expect(storePane).not.toContain('paywall.restore');
    expect(storePane).not.toContain('restorePremiumSubscription');
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
    expect(rewardedAds).toContain('RewardedAdEventType.EARNED_REWARD');
    expect(rewardedAds).toContain('AdEventType.CLOSED');
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

  it('does not label retryable ad initialization failures as unsupported', () => {
    expect(storePane).toContain("if (ready.reason === 'consent_required')");
    expect(storePane).toContain(
      "ready.reason === 'missing_module' || ready.reason === 'unsupported'",
    );
    expect(storePane).toContain("setAdState('error')");
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
    // Premium session (isPro) must also unlock the tools LA row.
    expect(mapScreen).toContain('liveActivityUnlocked');
    expect(mapScreen).toContain('liveActivityEffective || isPro');
    // Do not force full sheet (kills Stage-1 gather-card hit testing).
    expect(mapScreen).toMatch(/openStoreForLiveActivity[\s\S]*?midIndex/);
    expect(mapScreen).not.toMatch(
      /openStoreForLiveActivity[\s\S]*?setDetent\(Math\.max\(0, detents\.length - 1\)\)/,
    );
  });

  it('route pane shows extra credits only when > 0', () => {
    expect(mapScreen).toContain('extraPointCredits > 0');
    expect(mapScreen).toContain('route-extra-point-credits');
  });
});
