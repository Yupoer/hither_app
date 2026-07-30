/**
 * Store pane shell + wired balance / ad CTA / catalog redeem.
 * Extracted from MapScreen so the sheet host stays thin.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  AppState,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { isNetworkRequestError, requireUserId } from '../../../api/services/_helpers';
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

/** Soft poll while SSV is pending; then idle CTA + slower background late-SSV poll. */
const VERIFY_POLL_TICKS = 20;
const VERIFY_POLL_MS = 1500;
const LATE_SSV_POLL_MS = 8000;
const LATE_SSV_POLL_TICKS = 45; // ~6 min total soft watch after primary poll

type TFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

type PendingRedeem = {
  userId: string;
  productCode: string;
  groupId: string | null;
  clientRequestKey: string;
  createdAt: number;
};

function snapshotCacheKey(userId: string, groupId: string | null | undefined): string {
  return `hither.store.snapshot.v2:${userId}:${groupId ?? 'none'}`;
}

function pendingRedeemKey(userId: string, productCode: string, groupId: string | null): string {
  return `hither.store.pending_redeem.v1:${userId}:${productCode}:${groupId ?? 'none'}`;
}

async function currentUserIdOrNull(): Promise<string | null> {
  try {
    return await requireUserId();
  } catch {
    return null;
  }
}

async function readCachedSnapshot(
  userId: string,
  groupId: string | null | undefined,
): Promise<StoreSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(snapshotCacheKey(userId, groupId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoreSnapshot;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCachedSnapshot(
  userId: string,
  groupId: string | null | undefined,
  snap: StoreSnapshot,
): Promise<void> {
  try {
    await AsyncStorage.setItem(snapshotCacheKey(userId, groupId), JSON.stringify(snap));
  } catch {
    /* ignore quota */
  }
}

async function readPendingRedeem(
  userId: string,
  productCode: string,
  groupId: string | null,
): Promise<PendingRedeem | null> {
  try {
    const raw = await AsyncStorage.getItem(pendingRedeemKey(userId, productCode, groupId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingRedeem;
    if (!parsed?.clientRequestKey) return null;
    // Drop stale pending keys after 24h.
    if (Date.now() - (parsed.createdAt ?? 0) > 24 * 60 * 60 * 1000) {
      await AsyncStorage.removeItem(pendingRedeemKey(userId, productCode, groupId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writePendingRedeem(pending: PendingRedeem): Promise<void> {
  try {
    await AsyncStorage.setItem(
      pendingRedeemKey(pending.userId, pending.productCode, pending.groupId),
      JSON.stringify(pending),
    );
  } catch {
    /* ignore */
  }
}

async function clearPendingRedeem(
  userId: string,
  productCode: string,
  groupId: string | null,
): Promise<void> {
  try {
    await AsyncStorage.removeItem(pendingRedeemKey(userId, productCode, groupId));
  } catch {
    /* ignore */
  }
}

function newClientRequestKey(): string {
  return `crk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export interface StorePaneProps {
  groupId: string | null | undefined;
  groupName: string | null | undefined;
  isAnonymous: boolean;
  accent: string;
  t: TFn;
  /** When set, surface this product near the top and highlight it. */
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
  const latePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const controllerRef = useRef<ReturnType<typeof createRewardedAdController>>(null);
  const balanceAtVerifyRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const verifyingRef = useRef(false);
  const highlightCardRef = useRef<View | null>(null);
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;

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
    return true;
  }, []);

  const refresh = useCallback(async () => {
    const requestGroup = groupId ?? null;
    try {
      const snap = await getStoreSnapshot(requestGroup);
      // Drop stale responses after group switch.
      if ((groupIdRef.current ?? null) !== requestGroup) return null;
      setSnapshot(snap);
      setOffline(false);
      const uid = await currentUserIdOrNull();
      if (uid) void writeCachedSnapshot(uid, requestGroup, snap);
      return snap;
    } catch (e) {
      if ((groupIdRef.current ?? null) !== requestGroup) return null;
      if (isNetworkRequestError(e) || isDefinitelyOffline(getNavigatorOnline())) {
        setOffline(true);
        const uid = await currentUserIdOrNull();
        if (uid) {
          const cached = await readCachedSnapshot(uid, requestGroup);
          if (cached && (groupIdRef.current ?? null) === requestGroup) {
            setSnapshot((prev) => prev ?? cached);
          }
        }
      }
      return null;
    } finally {
      if ((groupIdRef.current ?? null) === requestGroup) {
        setLoading(false);
      }
    }
  }, [groupId]);

  useEffect(() => {
    // Clear previous team snapshot on group change (avoid cross-team offline bleed).
    setSnapshot(null);
    setLoading(true);
    void (async () => {
      const uid = await currentUserIdOrNull();
      if (uid) {
        const cached = await readCachedSnapshot(uid, groupId);
        if ((groupIdRef.current ?? null) === (groupId ?? null) && cached) {
          setSnapshot(cached);
        }
      }
      await refreshConnectivity();
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / group change only
  }, [groupId]);

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
    try {
      // Server only allows active → failed (not verifying → failed).
      await updateRewardSessionStatus(sessionRef, 'failed');
    } catch {
      /* best-effort; expiry still clears eventually */
    }
    if (activeSessionRef.current === sessionRef) {
      activeSessionRef.current = null;
    }
    verifyingRef.current = false;
  }, []);

  const markVerifyingSession = useCallback(async (sessionRef: string | null | undefined) => {
    if (!sessionRef) return;
    verifyingRef.current = true;
    try {
      await updateRewardSessionStatus(sessionRef, 'verifying');
    } catch {
      /* SSV credit path still works from active */
    }
  }, []);

  // Deep-link highlight: pin product + accessibility focus.
  useEffect(() => {
    if (!highlightProductCode) return;
    setHighlight(highlightProductCode);
    onHighlightConsumed?.();
    const t = setTimeout(() => {
      const node = highlightCardRef.current
        ? findNodeHandle(highlightCardRef.current)
        : null;
      if (node != null) {
        AccessibilityInfo.setAccessibilityFocus(node);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [highlightProductCode, onHighlightConsumed]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (latePollRef.current) clearInterval(latePollRef.current);
    controllerRef.current?.dispose();
  }, []);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const stopLatePoll = () => {
    if (latePollRef.current) {
      clearInterval(latePollRef.current);
      latePollRef.current = null;
    }
  };

  const onBalanceCredited = useCallback(() => {
    setAdState('credited');
    stopPoll();
    stopLatePoll();
    activeSessionRef.current = null;
    verifyingRef.current = false;
    void diagnostics.write({
      event: 'store_ledger_credit',
      source: 'store',
      status: 'credited',
      success: true,
    }).catch(() => undefined);
  }, []);

  const startLateSsvPoll = useCallback((baseline: number) => {
    stopLatePoll();
    balanceAtVerifyRef.current = baseline;
    let ticks = 0;
    latePollRef.current = setInterval(() => {
      ticks += 1;
      void refresh().then((snap) => {
        if (snap && snap.balance > (balanceAtVerifyRef.current ?? 0)) {
          onBalanceCredited();
          return;
        }
        if (ticks >= LATE_SSV_POLL_TICKS) {
          stopLatePoll();
        }
      });
    }, LATE_SSV_POLL_MS);
  }, [onBalanceCredited, refresh]);

  const startVerifyPoll = useCallback((baseline: number) => {
    stopPoll();
    stopLatePoll();
    balanceAtVerifyRef.current = baseline;
    setAdState('verifying');
    let ticks = 0;
    pollRef.current = setInterval(() => {
      ticks += 1;
      void refresh().then((snap) => {
        // Always evaluate timeout even when snapshot fails (network/RPC errors).
        if (snap && snap.balance > (balanceAtVerifyRef.current ?? 0)) {
          onBalanceCredited();
          return;
        }
        if (ticks >= VERIFY_POLL_TICKS) {
          // Re-enable CTA; keep slower background poll for late SSV.
          // Do NOT mark session failed — server/expiry owns verifying terminal.
          stopPoll();
          setAdState('idle');
          verifyingRef.current = false;
          // Keep activeSessionRef for session_active resume path.
          startLateSsvPoll(balanceAtVerifyRef.current ?? baseline);
        }
      });
    }, VERIFY_POLL_MS);
  }, [onBalanceCredited, refresh, startLateSsvPoll]);

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
    const reachable = await refreshConnectivity();
    if (reachable === false) {
      Alert.alert(t('store.offlineTitle'), t('store.offlineBody'));
      return;
    }
    adBusyRef.current = true;
    let sessionRef: string | null = null;
    verifyingRef.current = false;
    try {
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      const ready = await ensureRewardedAdsReady();
      if (!ready.available) {
        if (ready.reason === 'consent_required') {
          setAdState('consent_required');
        } else {
          setAdState('unsupported');
        }
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
          // Unfinished verifying session still open — resume late-SSV poll, not a hard stop.
          setAdState('session_active');
          startVerifyPoll(snapshot?.balance ?? 0);
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

      // onState only for UI transitions; verify poll starts once from show() path
      // to avoid double markVerifying/startVerifyPoll when earn fires once.
      const controller = createRewardedAdController(platform, {
        onState: (s) => {
          setAdState((prev) => {
            if (prev === 'no_fill' && s === 'error') return prev;
            return s;
          });
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
        // Preserve distinct no_fill vs error for CTA copy / retry.
        setAdState(loadState);
        await failSession(sessionRef);
        return;
      }

      setAdState('showing');
      void diagnostics.write({
        event: 'store_ad_show',
        source: 'store',
        status: 'showing',
        success: true,
      }).catch(() => undefined);

      // show() waits for EARNED_REWARD / CLOSED — not present-start.
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
        // Only fail if still active (not verifying). Server rejects verifying→failed.
        if (!verifyingRef.current) {
          await failSession(sessionRef);
        }
      } else if (showState === 'no_fill') {
        setAdState('no_fill');
        await failSession(sessionRef);
      } else if (showState === 'network_error') {
        setAdState('network_error');
        await failSession(sessionRef);
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
    const redeemGroupId = isTeam ? (groupId ?? null) : null;
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
                const uid = await currentUserIdOrNull();
                if (!uid) {
                  Alert.alert(t('store.redeemFailed'), t('store.registerRequired'));
                  return;
                }
                // Reuse pending key after lost response so retry is idempotent.
                const existing = await readPendingRedeem(uid, product.code, redeemGroupId);
                const clientRequestKey = existing?.clientRequestKey ?? newClientRequestKey();
                if (!existing) {
                  await writePendingRedeem({
                    userId: uid,
                    productCode: product.code,
                    groupId: redeemGroupId,
                    clientRequestKey,
                    createdAt: Date.now(),
                  });
                }
                const result = await redeemStoreProduct(
                  product.code,
                  redeemGroupId,
                  clientRequestKey,
                );
                if (!result.ok) {
                  // Keep pending key only for transport-ish failures so user can retry.
                  if (result.error !== 'insufficient_balance'
                    && result.error !== 'not_applicable'
                    && result.error !== 'product_unavailable'
                    && result.error !== 'not_member'
                    && result.error !== 'idempotency_conflict') {
                    /* keep pending */
                  } else {
                    await clearPendingRedeem(uid, product.code, redeemGroupId);
                  }
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
                  } else if (result.error === 'idempotency_conflict') {
                    await clearPendingRedeem(uid, product.code, redeemGroupId);
                    Alert.alert(t('store.redeemFailed'), t('store.idempotencyConflict'));
                  } else {
                    Alert.alert(t('store.redeemFailed'), result.error ?? t('store.redeemFailed'));
                  }
                  return;
                }
                await clearPendingRedeem(uid, product.code, redeemGroupId);
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

  const allProducts = snapshot?.catalog ?? [];
  const teamProducts = allProducts.filter((p) => p.scope === 'team');
  const personalProducts = allProducts.filter((p) => p.scope === 'personal');

  // Deep-link: lift highlighted product to a pin slot under the ad CTA.
  const pinnedProduct = highlight
    ? allProducts.find((p) => p.code === highlight) ?? null
    : null;
  const teamList = pinnedProduct?.scope === 'team'
    ? teamProducts.filter((p) => p.code !== pinnedProduct.code)
    : teamProducts;
  const personalList = pinnedProduct?.scope === 'personal'
    ? personalProducts.filter((p) => p.code !== pinnedProduct.code)
    : personalProducts;

  const balance = snapshot?.balance ?? 0;
  const credits = snapshot?.extraPointCredits ?? 0;
  const fromCacheOnly = offline && !!snapshot;

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
            <Text style={styles.shellHint}>
              {fromCacheOnly ? t('store.offlineCachedHint') : t('store.balanceHint')}
            </Text>
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

      {pinnedProduct ? (
        <View ref={highlightCardRef} testID="store-product-pinned" collapsable={false}>
          <Text style={styles.heading}>{t('store.highlightedProduct')}</Text>
          <ProductCard
            product={pinnedProduct}
            balance={balance}
            accent={accent}
            styles={styles}
            t={t}
            highlighted
            redeeming={redeeming === pinnedProduct.code}
            disabled={isAnonymous || offline || !!redeeming}
            onRedeem={() => confirmRedeem(pinnedProduct)}
          />
        </View>
      ) : null}

      <Text style={styles.heading}>{t('store.teamProducts')}</Text>
      {teamList.length === 0 && !loading && !pinnedProduct ? (
        <View style={styles.shellCard} testID="store-team-empty">
          <Text style={styles.shellHint}>{t('store.emptyCatalog')}</Text>
        </View>
      ) : (
        teamList.map((p) => (
          <ProductCard
            key={p.code}
            product={p}
            balance={balance}
            accent={accent}
            styles={styles}
            t={t}
            highlighted={false}
            redeeming={redeeming === p.code}
            disabled={isAnonymous || offline || !!redeeming}
            onRedeem={() => confirmRedeem(p)}
          />
        ))
      )}

      <Text style={styles.heading}>{t('store.personalProducts')}</Text>
      {personalList.length === 0 && !loading && pinnedProduct?.scope !== 'personal' ? (
        <View style={styles.shellCard} testID="store-personal-empty">
          <Text style={styles.shellHint}>{t('store.emptyCatalog')}</Text>
        </View>
      ) : (
        personalList.map((p) => (
          <ProductCard
            key={p.code}
            product={p}
            balance={balance}
            accent={accent}
            styles={styles}
            t={t}
            highlighted={false}
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
      accessibilityState={{ selected: highlighted }}
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
