/**
 * Store pane shell + wired balance / ad CTA / catalog redeem.
 * Extracted from MapScreen so the sheet host stays thin.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { glass } from '../../../glass';
import { GLOBAL_FONT_SCALE_CAP } from '../../../theme/typeScale';
import { useFontLayout } from '../../../a11y/useFontScaleBucket';
import type { TranslationKey } from '../../../i18n';
import {
  createRewardSession,
  getStoreSnapshot,
  redeemStoreProduct,
  updateRewardSessionStatus,
} from '../../../api/services/StoreService';
import { isNetworkRequestError } from '../../../api/services/_helpers';
import {
  createRewardedAdController,
  ensureRewardedAdsReady,
} from '../../../native/rewardedAds';
import type {
  RewardedAdUiState,
  StoreCatalogProduct,
  StoreSnapshot,
} from '../../../store/types';
import {
  getConnectivitySnapshot,
  getNavigatorOnline,
  isDefinitelyOffline,
  probeReachability,
  subscribeConnectivity,
} from '../../../store/connectivity';
import { diagnostics } from '../../../state/diagnostics';

/** Grace after ad dismiss without earn before failing the reward session (ms). */
const DISMISS_FAIL_GRACE_MS = 2000;

type TFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

export interface StorePaneProps {
  groupId: string | null | undefined;
  groupName: string | null | undefined;
  isAnonymous: boolean;
  accent: string;
  t: TFn;
  /** When set, scroll/highlight this product (e.g. live activity deep link). */
  highlightProductCode?: string | null;
  onHighlightConsumed?: () => void;
  onRequireRegistration?: () => void;
  onEntitlementChanged?: () => void;
}

function adCtaLabel(state: RewardedAdUiState, t: TFn): string {
  switch (state) {
    case 'loading':
      return t('store.adLoading');
    case 'ready':
      return t('store.adReady');
    case 'showing':
      return t('store.adShowing');
    case 'verifying':
      return t('store.adVerifying');
    case 'credited':
      return t('store.adCredited');
    case 'no_fill':
      return t('store.adNoFill');
    case 'network_error':
      return t('store.adNetworkError');
    case 'consent_required':
      return t('store.adConsent');
    case 'unsupported':
      return t('store.adUnsupported');
    case 'registration_required':
      return t('store.registerRequired');
    case 'session_active':
      return t('store.adSessionActive');
    case 'error':
      return t('store.adError');
    case 'dismissed':
      return t('store.adDismissed');
    default:
      return t('store.adWatch');
  }
}

export const StorePane = React.memo(function StorePane({
  groupId,
  groupName,
  isAnonymous,
  accent,
  t,
  highlightProductCode,
  onHighlightConsumed,
  onRequireRegistration,
  onEntitlementChanged,
}: StorePaneProps) {
  const { scale, boldText } = useFontLayout();
  const styles = useMemo(() => makeStyles(scale, boldText), [scale, boldText]);
  const [snapshot, setSnapshot] = useState<StoreSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(() => isDefinitelyOffline(getNavigatorOnline()));
  const [adState, setAdState] = useState<RewardedAdUiState>('idle');
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const adBusyRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const controllerRef = useRef<ReturnType<typeof createRewardedAdController>>(null);
  const balanceAtVerifyRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const dismissFailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verifyingRef = useRef(false);

  const clearDismissFailTimer = useCallback(() => {
    if (dismissFailTimerRef.current) {
      clearTimeout(dismissFailTimerRef.current);
      dismissFailTimerRef.current = null;
    }
  }, []);

  const refreshConnectivity = useCallback(async () => {
    const snap = await getConnectivitySnapshot();
    if (snap.online === false) {
      setOffline(true);
      return false;
    }
    if (snap.online === true) {
      setOffline(false);
      return true;
    }
    // Unknown: optional probe against Supabase URL (no NetInfo).
    const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const probed = await probeReachability(baseUrl);
    if (probed === false) {
      setOffline(true);
      return false;
    }
    if (probed === true) {
      setOffline(false);
      return true;
    }
    // Still unknown — do not block (RPC will surface network errors).
    return true;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const snap = await getStoreSnapshot(groupId ?? null);
      setSnapshot(snap);
      setOffline(false);
      return snap;
    } catch (e) {
      if (isNetworkRequestError(e) || isDefinitelyOffline(getNavigatorOnline())) {
        setOffline(true);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void (async () => {
      await refreshConnectivity();
      await refresh();
    })();
  }, [refresh, refreshConnectivity]);

  useEffect(() => {
    const unsubNet = subscribeConnectivity((online) => {
      if (online === false) setOffline(true);
      else if (online === true) setOffline(false);
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void (async () => {
          const ok = await refreshConnectivity();
          if (ok !== false) void refresh();
        })();
      }
    });
    return () => {
      unsubNet();
      sub.remove();
    };
  }, [refresh, refreshConnectivity]);

  const failSession = useCallback(async (sessionRef: string | null | undefined) => {
    if (!sessionRef) return;
    clearDismissFailTimer();
    try {
      await updateRewardSessionStatus(sessionRef, 'failed');
    } catch {
      /* best-effort; expiry still clears eventually */
    }
    if (activeSessionRef.current === sessionRef) {
      activeSessionRef.current = null;
    }
    verifyingRef.current = false;
  }, [clearDismissFailTimer]);

  const markVerifyingSession = useCallback(async (sessionRef: string | null | undefined) => {
    if (!sessionRef) return;
    clearDismissFailTimer();
    verifyingRef.current = true;
    try {
      await updateRewardSessionStatus(sessionRef, 'verifying');
    } catch {
      /* SSV credit path still works from active */
    }
  }, [clearDismissFailTimer]);

  useEffect(() => {
    if (highlightProductCode) {
      setHighlight(highlightProductCode);
      onHighlightConsumed?.();
    }
  }, [highlightProductCode, onHighlightConsumed]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    clearDismissFailTimer();
    controllerRef.current?.dispose();
  }, [clearDismissFailTimer]);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startVerifyPoll = useCallback((baseline: number) => {
    stopPoll();
    balanceAtVerifyRef.current = baseline;
    setAdState('verifying');
    let ticks = 0;
    pollRef.current = setInterval(() => {
      ticks += 1;
      void refresh().then((snap) => {
        if (!snap) return;
        if (snap.balance > (balanceAtVerifyRef.current ?? 0)) {
          setAdState('credited');
          stopPoll();
          void diagnostics.write({
            event: 'store_ledger_credit',
            source: 'store',
            status: 'credited',
            success: true,
          }).catch(() => undefined);
        } else if (ticks >= 20) {
          // Keep verifying UI soft — late SSV may still arrive; stop busy poll.
          stopPoll();
        }
      });
    }, 1500);
  }, [refresh]);

  const onWatchAd = useCallback(async () => {
    if (adBusyRef.current) return;
    if (isAnonymous) {
      setAdState('registration_required');
      onRequireRegistration?.();
      return;
    }
    if (offline || isDefinitelyOffline(getNavigatorOnline())) {
      setOffline(true);
      Alert.alert(t('store.offlineTitle'), t('store.offlineBody'));
      return;
    }
    // Re-check connectivity before starting (cold offline may not have navigator).
    const reachable = await refreshConnectivity();
    if (reachable === false) {
      Alert.alert(t('store.offlineTitle'), t('store.offlineBody'));
      return;
    }
    adBusyRef.current = true;
    let sessionRef: string | null = null;
    verifyingRef.current = false;
    clearDismissFailTimer();
    try {
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      const ready = await ensureRewardedAdsReady();
      if (!ready.available) {
        setAdState('unsupported');
        void diagnostics.write({
          event: 'store_ad_load',
          source: 'store',
          status: ready.reason,
          success: false,
        }).catch(() => undefined);
        return;
      }

      setAdState('loading');
      const session = await createRewardSession(platform);
      if (!session.ok || !session.sessionRef) {
        if (session.error === 'registration_required') {
          setAdState('registration_required');
          onRequireRegistration?.();
        } else if (session.error === 'session_active') {
          setAdState('session_active');
        } else if (isNetworkRequestError(session.error) || /network|fetch|offline/i.test(String(session.error))) {
          setOffline(true);
          setAdState('network_error');
        } else {
          setAdState('error');
        }
        return;
      }
      sessionRef = session.sessionRef;
      activeSessionRef.current = sessionRef;

      const controller = createRewardedAdController(platform, {
        onState: (s) => {
          setAdState(s);
          if (s === 'verifying') {
            void markVerifyingSession(sessionRef);
            startVerifyPoll(snapshot?.balance ?? 0);
          }
        },
      });
      controllerRef.current?.dispose();
      controllerRef.current = controller;
      if (!controller) {
        setAdState('unsupported');
        await failSession(sessionRef);
        return;
      }

      const loadState = await controller.load(session.sessionRef);
      void diagnostics.write({
        event: 'store_ad_load',
        source: 'store',
        status: loadState,
        success: loadState === 'ready',
      }).catch(() => undefined);

      if (loadState !== 'ready') {
        setAdState(loadState === 'error' ? 'error' : loadState);
        // Immediate fail for no-fill / load error (releases unfinished slot).
        await failSession(sessionRef);
        return;
      }

      // User already initiated — show immediately after load for this tap.
      setAdState('showing');
      void diagnostics.write({
        event: 'store_ad_show',
        source: 'store',
        status: 'showing',
        success: true,
      }).catch(() => undefined);
      const showState = await controller.show();
      if (showState === 'verifying') {
        void diagnostics.write({
          event: 'store_ad_reward_client',
          source: 'store',
          status: 'verifying',
          success: true,
        }).catch(() => undefined);
        await markVerifyingSession(sessionRef);
        startVerifyPoll(snapshot?.balance ?? 0);
      } else if (showState === 'dismissed') {
        void diagnostics.write({
          event: 'store_ad_dismiss',
          source: 'store',
          status: 'dismissed',
          success: false,
        }).catch(() => undefined);
        setAdState('dismissed');
        // Grace: CLOSED may precede EARNED_REWARD; do not fail immediately.
        // If verifying arrives (or already set), cancel; otherwise fail after grace.
        const ref = sessionRef;
        clearDismissFailTimer();
        dismissFailTimerRef.current = setTimeout(() => {
          if (verifyingRef.current) return;
          if (activeSessionRef.current !== ref) return;
          void failSession(ref);
        }, DISMISS_FAIL_GRACE_MS);
      } else if (showState === 'error') {
        setAdState('error');
        await failSession(sessionRef);
      }
    } finally {
      adBusyRef.current = false;
    }
  }, [
    isAnonymous,
    offline,
    onRequireRegistration,
    snapshot?.balance,
    startVerifyPoll,
    failSession,
    markVerifyingSession,
    refreshConnectivity,
    clearDismissFailTimer,
    t,
  ]);

  const confirmRedeem = useCallback((product: StoreCatalogProduct) => {
    if (isAnonymous) {
      onRequireRegistration?.();
      return;
    }
    if (offline || isDefinitelyOffline(getNavigatorOnline())) {
      setOffline(true);
      Alert.alert(t('store.offlineTitle'), t('store.offlineBody'));
      return;
    }
    if (!snapshot?.canRedeem) return;
    const isTeam = product.scope === 'team';
    if (isTeam && !groupId) {
      Alert.alert(t('store.redeemFailed'), t('store.needTeam'));
      return;
    }
    const teamLine = isTeam
      ? t('store.confirmTeam', { name: groupName ?? t('store.currentTeam') })
      : t('store.confirmPersonal');
    Alert.alert(
      t('store.confirmTitle'),
      `${product.displayName}\n${teamLine}\n${t('store.confirmPrice', {
        price: product.priceTokens,
      })}\n${t('store.confirmNonRefundable')}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('store.confirmAction'),
          onPress: () => {
            void (async () => {
              setRedeeming(product.code);
              try {
                const result = await redeemStoreProduct(
                  product.code,
                  isTeam ? groupId : null,
                );
                if (!result.ok) {
                  void diagnostics.write({
                    event: 'store_redemption_failure',
                    source: 'store',
                    status: String(result.error ?? 'error'),
                    success: false,
                  }).catch(() => undefined);
                  if (result.error === 'insufficient_balance') {
                    Alert.alert(
                      t('store.insufficientTitle'),
                      t('store.insufficientBody', {
                        shortfall: result.shortfall ?? product.priceTokens,
                      }),
                    );
                  } else if (result.error === 'not_applicable') {
                    Alert.alert(t('store.notApplicableTitle'), result.message ?? t('store.notApplicableBody'));
                  } else {
                    Alert.alert(t('store.redeemFailed'), result.error ?? t('store.redeemFailed'));
                  }
                  return;
                }
                void diagnostics.write({
                  event: 'store_redemption_success',
                  source: 'store',
                  status: product.code,
                  success: true,
                }).catch(() => undefined);
                await refresh();
                onEntitlementChanged?.();
              } finally {
                setRedeeming(null);
              }
            })();
          },
        },
      ],
    );
  }, [
    groupId,
    groupName,
    isAnonymous,
    offline,
    onEntitlementChanged,
    onRequireRegistration,
    refresh,
    snapshot?.canRedeem,
    t,
  ]);

  const teamProducts = (snapshot?.catalog ?? []).filter((p) => p.scope === 'team');
  const personalProducts = (snapshot?.catalog ?? []).filter((p) => p.scope === 'personal');
  const balance = snapshot?.balance ?? 0;
  const credits = snapshot?.extraPointCredits ?? 0;

  const adDisabled =
    isAnonymous
    || offline
    || adState === 'loading'
    || adState === 'showing'
    || adState === 'verifying'
    || adBusyRef.current;

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={t('store.title')}
      testID="store-pane"
    >
      <Text style={[styles.heading, styles.headingFirst]}>{t('store.title')}</Text>

      {loading && !snapshot ? (
        <View style={styles.shellCard} testID="store-loading">
          <ActivityIndicator color={accent} />
          <Text style={styles.shellHint}>{t('store.loading')}</Text>
        </View>
      ) : null}

      {isAnonymous ? (
        <View style={styles.shellCard} testID="store-anonymous-gate">
          <Text style={styles.balanceLabel}>{t('store.registerRequired')}</Text>
          <Text style={styles.shellHint}>{t('store.registerHint')}</Text>
          <Pressable
            style={[styles.cta, { backgroundColor: accent }]}
            onPress={() => onRequireRegistration?.()}
            accessibilityRole="button"
            accessibilityLabel={t('store.registerCta')}
          >
            <Text style={styles.ctaTextDark}>{t('store.registerCta')}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.balanceCard} testID="store-balance">
            <Text style={styles.balanceLabel}>{t('store.balance')}</Text>
            <Text
              style={styles.balanceValue}
              accessibilityRole="text"
              accessibilityLabel={t('store.balanceA11y', { count: balance })}
              maxFontSizeMultiplier={GLOBAL_FONT_SCALE_CAP}
            >
              {balance}
            </Text>
            <Text style={styles.shellHint}>{t('store.balanceHint')}</Text>
          </View>

          {offline ? (
            <Text style={styles.shellHint} testID="store-offline-banner">
              {t('store.offlineBody')}
            </Text>
          ) : null}

          <Pressable
            style={[styles.cta, { backgroundColor: adDisabled ? glass.fill : accent }]}
            onPress={() => { void onWatchAd(); }}
            disabled={adDisabled}
            accessibilityRole="button"
            accessibilityState={{
              disabled: adDisabled,
              busy: adState === 'loading' || adState === 'showing' || adState === 'verifying',
            }}
            accessibilityLabel={offline ? t('store.offlineTitle') : adCtaLabel(adState, t)}
            testID="store-ad-cta"
          >
            <Ionicons
              name="play-circle-outline"
              size={20}
              color={adDisabled ? glass.textSecondary : '#111'}
            />
            <Text style={[styles.ctaText, adDisabled && styles.ctaTextMuted]}>
              {offline ? t('store.offlineCta') : adCtaLabel(adState, t)}
            </Text>
          </Pressable>
          <Text style={styles.shellHint}>{t('store.adRewardHint')}</Text>
        </>
      )}

      <Text style={styles.heading}>{t('store.teamProducts')}</Text>
      {teamProducts.length === 0 && !loading ? (
        <View style={styles.shellCard} testID="store-team-empty">
          <Text style={styles.shellHint}>{t('store.emptyCatalog')}</Text>
        </View>
      ) : (
        teamProducts.map((p) => (
          <ProductCard
            key={p.code}
            product={p}
            balance={balance}
            accent={accent}
            styles={styles}
            t={t}
            highlighted={highlight === p.code}
            redeeming={redeeming === p.code}
            disabled={isAnonymous || offline || !!redeeming}
            onRedeem={() => confirmRedeem(p)}
          />
        ))
      )}

      <Text style={styles.heading}>{t('store.personalProducts')}</Text>
      {personalProducts.length === 0 && !loading ? (
        <View style={styles.shellCard} testID="store-personal-empty">
          <Text style={styles.shellHint}>{t('store.emptyCatalog')}</Text>
        </View>
      ) : (
        personalProducts.map((p) => (
          <ProductCard
            key={p.code}
            product={p}
            balance={balance}
            accent={accent}
            styles={styles}
            t={t}
            highlighted={highlight === p.code}
            redeeming={redeeming === p.code}
            disabled={isAnonymous || offline || !!redeeming}
            onRedeem={() => confirmRedeem(p)}
          />
        ))
      )}

      {credits > 0 ? (
        <Text style={styles.shellHint} testID="store-credits-hint">
          {t('store.extraCreditsRemaining', { count: credits })}
        </Text>
      ) : null}
    </View>
  );
});

function ProductCard({
  product,
  balance,
  accent,
  styles,
  t,
  highlighted,
  redeeming,
  disabled,
  onRedeem,
}: {
  product: StoreCatalogProduct;
  balance: number;
  accent: string;
  styles: ReturnType<typeof makeStyles>;
  t: TFn;
  highlighted: boolean;
  redeeming: boolean;
  disabled: boolean;
  onRedeem: () => void;
}) {
  const shortfall = Math.max(0, product.priceTokens - balance);
  const canAfford = shortfall === 0;
  return (
    <View
      style={[styles.productCard, highlighted && { borderColor: accent, borderWidth: 1.5 }]}
      accessibilityRole="summary"
      accessibilityLabel={`${product.displayName}, ${product.scope}, ${product.priceTokens}`}
      testID={`store-product-${product.code}`}
    >
      <View style={styles.productTop}>
        <Text style={styles.productTitle} numberOfLines={2}>{product.displayName}</Text>
        <Text style={styles.productPrice}>{t('store.priceTokens', { count: product.priceTokens })}</Text>
      </View>
      <Text style={styles.productScope}>
        {product.scope === 'team' ? t('store.scopeTeam') : t('store.scopePersonal')}
      </Text>
      {!canAfford ? (
        <Text style={styles.shortfall}>
          {t('store.shortfall', { count: shortfall })}
        </Text>
      ) : null}
      <Pressable
        style={[
          styles.redeemBtn,
          { backgroundColor: canAfford && !disabled ? accent : glass.fill },
        ]}
        onPress={onRedeem}
        disabled={disabled || !canAfford || redeeming}
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || !canAfford || redeeming, busy: redeeming }}
        accessibilityLabel={t('store.redeem')}
      >
        {redeeming ? (
          <ActivityIndicator color="#111" />
        ) : (
          <Text style={[styles.redeemText, (!canAfford || disabled) && styles.ctaTextMuted]}>
            {t('store.redeem')}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const makeStyles = (scale: number, boldText: boolean) => {
  const s = (n: number, min = 0) => Math.max(min, Math.round(n * scale));
  return StyleSheet.create({
    heading: {
      fontSize: s(boldText ? 13 : 14, 12),
      fontWeight: boldText ? '600' : '700',
      color: glass.textSecondary,
      marginTop: s(14, 10),
      marginBottom: s(8, 6),
    },
    headingFirst: { marginTop: 0 },
    balanceCard: {
      backgroundColor: glass.fill,
      borderRadius: s(14, 12),
      padding: s(14, 12),
      marginBottom: s(10, 8),
    },
    balanceLabel: {
      fontSize: s(13, 12),
      color: glass.textSecondary,
      fontWeight: '600',
    },
    balanceValue: {
      fontSize: s(32, 26),
      fontWeight: '800',
      color: '#fff',
      marginTop: 2,
    },
    shellCard: {
      backgroundColor: glass.fill,
      borderRadius: s(14, 12),
      padding: s(14, 12),
      marginBottom: s(10, 8),
      gap: s(8, 6),
      alignItems: 'flex-start',
    },
    shellHint: {
      fontSize: s(12, 11),
      color: glass.textTertiary,
      marginBottom: s(8, 6),
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: s(14, 12),
      paddingVertical: s(12, 10),
      paddingHorizontal: s(14, 12),
      marginBottom: s(6, 4),
    },
    ctaText: {
      fontSize: s(15, 13),
      fontWeight: '700',
      color: '#111',
    },
    ctaTextDark: {
      fontSize: s(15, 13),
      fontWeight: '700',
      color: '#111',
    },
    ctaTextMuted: { color: glass.textSecondary },
    productCard: {
      backgroundColor: glass.fill,
      borderRadius: s(14, 12),
      padding: s(12, 10),
      marginBottom: s(8, 6),
    },
    productTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 8,
      alignItems: 'flex-start',
    },
    productTitle: {
      flex: 1,
      fontSize: s(15, 13),
      fontWeight: '700',
      color: '#fff',
    },
    productPrice: {
      fontSize: s(14, 12),
      fontWeight: '700',
      color: glass.textSecondary,
    },
    productScope: {
      fontSize: s(12, 11),
      color: glass.textTertiary,
      marginTop: 4,
      marginBottom: 8,
    },
    shortfall: {
      fontSize: s(12, 11),
      color: glass.warn,
      marginBottom: 8,
    },
    redeemBtn: {
      borderRadius: s(12, 10),
      paddingVertical: s(10, 8),
      alignItems: 'center',
    },
    redeemText: {
      fontSize: s(14, 12),
      fontWeight: '700',
      color: '#111',
    },
  });
};
