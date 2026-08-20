/**
 * Shared Premium subscription presentation for Paywall (settings) and Store (inline).
 * Purchase/restore authority stays in premiumPurchaseFlow; this only owns UI + CTA state.
 * `showRestore` is true for Settings Paywall and false for the Store pane.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { getPremiumProjection, redeemPromoCode } from '../api/client';
import { waitUntilPremiumProjectionActive } from '../utils/waitUntilPremiumProjection';
import { runUiAction } from '../utils/uiAction';
import { useTranslation, type TranslationKey } from '../i18n';
import { useTheme } from '../state/PreferencesContext';
import { useSession } from '../state/SessionContext';
import {
  loadPremiumStoreProducts,
  purchasePremiumSubscription,
  restorePremiumSubscription,
} from '../services/premiumPurchaseFlow';
import { PREMIUM_CATALOG, premiumProductForPlan, type PremiumPlan } from '../premiumCatalog';
import { glass, accentMix } from '../glass';
import {
  hasEligibleIntroductoryOffer,
  type PremiumStoreProduct,
} from '../native/purchases';

/** Free vs account-owned auto-renewable Premium comparison rows. */
export const PAYWALL_INTRO_SLIDES: { key: string; title: TranslationKey; body: TranslationKey }[] = [
  { key: 'members', title: 'paywall.introMembers', body: 'paywall.rowMembersPro' },
  { key: 'destinations', title: 'paywall.introDestinations', body: 'paywall.rowDestinationsPro' },
  { key: 'kml', title: 'paywall.introKml', body: 'paywall.rowKmlPro' },
  { key: 'history', title: 'paywall.introHistory', body: 'paywall.rowHistoryPro' },
  { key: 'themes', title: 'paywall.introThemes', body: 'paywall.rowThemesPro' },
];

export const PREMIUM_COMPARE_ROWS: { free: TranslationKey; pro: TranslationKey }[] = [
  { free: 'paywall.rowMembersFree', pro: 'paywall.rowMembersPro' },
  { free: 'paywall.rowDestinationsFree', pro: 'paywall.rowDestinationsPro' },
  { free: 'paywall.rowKmlFree', pro: 'paywall.rowKmlPro' },
  { free: 'paywall.rowStragglerFree', pro: 'paywall.rowStragglerPro' },
  { free: 'paywall.rowHistoryFree', pro: 'paywall.rowHistoryPro' },
  { free: 'paywall.rowThemesFree', pro: 'paywall.rowThemesPro' },
];

export function productForPlan(
  products: readonly PremiumStoreProduct[],
  plan: PremiumPlan,
): PremiumStoreProduct | null {
  const config = premiumProductForPlan(plan);
  return config ? products.find((product) => product.id === config.productId) ?? null : null;
}

export type PremiumPresentationProps = {
  /** Settings Paywall keeps restore; Store inline mode hides it. */
  showRestore: boolean;
  /** Optional paywall trigger copy above the plan comparison. */
  trigger?: TranslationKey;
  /** Called after a successful purchase (Paywall closes; Store may refresh). */
  onPurchaseSuccess?: () => void;
  /** Called after a successful restore that unlocks premium. */
  onRestoreSuccess?: () => void;
  /** Optional testID prefix (default premium-presentation). */
  testID?: string;
  showIntroPager?: boolean;
  onUnlockingChange?: (unlocking: boolean) => void;
};

export default React.memo(function PremiumPresentation({
  showRestore,
  trigger,
  onPurchaseSuccess,
  onRestoreSuccess,
  testID = 'premium-presentation',
  showIntroPager = false,
  onUnlockingChange,
}: PremiumPresentationProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const {
    user,
    membership,
    isPro,
    premiumProjection,
    refreshEntitlement,
    refreshProfile,
  } = useSession();
  const accent = colors.accent;
  const { width: pagerWidth } = useWindowDimensions();
  const slideWidth = Math.max(280, pagerWidth - 48);
  const [busy, setBusy] = useState<'purchase' | 'restore' | 'redeem' | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<PremiumPlan>('monthly');
  const [products, setProducts] = useState<PremiumStoreProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    void loadPremiumStoreProducts()
      .then((next) => {
        if (active) setProducts(next);
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedProduct = useMemo(
    () => productForPlan(products, selectedPlan),
    [products, selectedPlan],
  );
  const catalogReady = PREMIUM_CATALOG.ready
    && productForPlan(products, 'monthly') !== null
    && productForPlan(products, 'annual') !== null;
  const hasPremium =
    isPro
    || premiumProjection.personalPremiumActive
    || premiumProjection.teamPremiumActive;
  const groupId = membership?.group.id ?? null;

  const statusLine = useMemo(() => {
    if (hasPremium && premiumProjection.expiresAt) {
      return t('paywall.expiresAt', {
        date: new Date(premiumProjection.expiresAt).toLocaleDateString(),
      });
    }
    if (hasPremium) return t('paywall.active');
    if (!user) return t('paywall.signInRequired');
    if (!PREMIUM_CATALOG.ready) return t('paywall.catalogUnavailable');
    return t('paywall.choosePlan');
  }, [hasPremium, premiumProjection.expiresAt, user, t]);

  const handlePurchase = useCallback(async () => {
    if (!user) {
      Alert.alert(t('paywall.title'), t('paywall.signInRequired'));
      return;
    }
    if (!catalogReady) {
      Alert.alert(t('paywall.title'), t('paywall.unavailable'));
      return;
    }
    setBusy('purchase');
    try {
      const result = await purchasePremiumSubscription(selectedPlan, {
        onNativePurchased: () => onUnlockingChange?.(true),
      });
      if (!result.ok) {
        onUnlockingChange?.(false);
        if (result.error === 'cancelled') return;
        if (result.error === 'pending') {
          Alert.alert(t('paywall.title'), t('paywall.pending'));
          return;
        }
        Alert.alert(t('paywall.title'), t('paywall.purchaseFailed'));
        return;
      }
      onUnlockingChange?.(true);
      await refreshProfile();
      await refreshEntitlement(groupId);
      const ready = await waitUntilPremiumProjectionActive({
        groupId,
        getPremiumProjection,
        alreadyActive:
          premiumProjection.personalPremiumActive || premiumProjection.teamPremiumActive,
      });
      if (!ready) {
        Alert.alert(t('paywall.title'), t('paywall.purchaseFailed'));
        return;
      }
      await refreshProfile();
      await refreshEntitlement(groupId);
      Alert.alert(t('paywall.title'), t('paywall.purchaseSuccess'));
      onPurchaseSuccess?.();
    } catch {
      Alert.alert(t('paywall.title'), t('paywall.purchaseFailed'));
    } finally {
      onUnlockingChange?.(false);
      setBusy(null);
    }
  }, [
    user,
    catalogReady,
    selectedPlan,
    groupId,
    t,
    refreshEntitlement,
    refreshProfile,
    onPurchaseSuccess,
    onUnlockingChange,
    premiumProjection.personalPremiumActive,
    premiumProjection.teamPremiumActive,
  ]);

  const handleRestore = useCallback(async () => {
    if (!user) {
      Alert.alert(t('paywall.title'), t('paywall.signInRequired'));
      return;
    }
    setBusy('restore');
    try {
      const restored = await restorePremiumSubscription(groupId);
      await refreshProfile();
      await refreshEntitlement(groupId);
      if (restored.projection.personalPremiumActive || restored.projection.teamPremiumActive) {
        Alert.alert(t('paywall.title'), t('paywall.restoreSuccess'));
        onRestoreSuccess?.();
        return;
      }
      if (
        restored.error === 'projection_unavailable'
        || restored.error === 'verification_service_unavailable'
      ) {
        Alert.alert(t('paywall.title'), t('paywall.unavailable'));
        return;
      }
      Alert.alert(t('paywall.title'), t('paywall.restoreNone'));
    } catch {
      Alert.alert(t('paywall.title'), t('paywall.restoreNone'));
    } finally {
      setBusy(null);
    }
  }, [user, groupId, t, refreshEntitlement, refreshProfile, onRestoreSuccess]);

  const redeemErrorMessage = useCallback((code: string): string => {
    switch (code) {
      case 'already_used':
        return t('paywall.redeem.alreadyUsed');
      case 'expired':
        return t('paywall.redeem.expired');
      case 'invalid':
        return t('paywall.redeem.invalid');
      case 'not_applicable':
        return t('paywall.redeem.notApplicable');
      case 'duplicate':
        return t('paywall.redeem.duplicate');
      case 'not_authenticated':
        return t('paywall.redeem.notAuthenticated');
      default:
        return t('paywall.redeem.failed');
    }
  }, [t]);

  const handleRedeem = useCallback(async () => {
    const code = promoCode.trim();
    if (!code) return;
    await runUiAction(
      'paywall.redeem',
      async (token) => {
        try {
          const result = await redeemPromoCode(code, membership?.group.id ?? null);
          if (!token.isCurrent()) return;
          await refreshProfile();
          if (!token.isCurrent()) return;
          await refreshEntitlement(membership?.group.id);
          if (!token.isCurrent()) return;
          Alert.alert(t('paywall.redeem.successTitle'), t('paywall.redeem.successBody', { plan: result.plan_name }));
          setPromoCode('');
          setRedeemOpen(false);
        } catch (e: unknown) {
          if (token.isCurrent()) {
            const codeKey =
              e && typeof e === 'object' && 'code' in e && typeof (e as { code?: string }).code === 'string'
                ? (e as { code: string }).code
                : e instanceof Error
                  ? e.message
                  : 'unknown';
            Alert.alert(t('paywall.redeem.failedTitle'), redeemErrorMessage(codeKey));
          }
          throw e;
        }
      },
      {
        screen: 'Paywall',
        suppressBanner: true,
        onBusyChange: (next) => setBusy(next ? 'redeem' : null),
        onError: (kind) => {
          if (kind === 'timeout') {
            Alert.alert(t('paywall.redeem.failedTitle'), t('interaction.timeout'));
          }
        },
      },
    );
  }, [promoCode, membership?.group.id, refreshProfile, refreshEntitlement, redeemErrorMessage, t]);

  return (
    <View style={styles.body} testID={testID} accessibilityRole="summary">
      {trigger ? <Text style={styles.trigger}>{t(trigger)}</Text> : null}

      <Text style={[styles.statusLine, { color: accent }]}>{statusLine}</Text>

      {showIntroPager ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          testID={`${testID}-intro-pager`}
          style={styles.introPager}
        >
          {PAYWALL_INTRO_SLIDES.map((slide) => (
            <View key={slide.key} style={[styles.introSlide, { width: slideWidth }]}>
              <Text style={styles.introTitle}>{t(slide.title)}</Text>
              <Text style={styles.introBody}>{t(slide.body)}</Text>
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.table}>
          {PREMIUM_COMPARE_ROWS.map((row, i) => (
            <View
              key={row.free}
              style={[styles.row, i === PREMIUM_COMPARE_ROWS.length - 1 && styles.rowLast]}
            >
              <Text style={styles.rowFree}>{t(row.free)}</Text>
              <Text style={[styles.rowPro, { color: accent }]}>{t(row.pro)}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.planChoices} accessibilityRole="radiogroup">
        {(['monthly', 'annual'] as const).map((plan) => {
          const product = productForPlan(products, plan);
          const selected = selectedPlan === plan;
          return (
            <Pressable
              key={plan}
              style={[
                styles.planChoice,
                { borderColor: selected ? accent : glass.hairlineStrong },
                selected && { backgroundColor: accentMix(accent, 15) },
              ]}
              onPress={() => setSelectedPlan(plan)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Text style={styles.planChoiceTitle}>
                {plan === 'monthly' ? t('paywall.monthly') : t('paywall.annual')}
              </Text>
              <Text style={[styles.planChoicePrice, { color: accent }]}>
                {product?.displayPrice ?? '—'}
              </Text>
              {product && hasEligibleIntroductoryOffer(product) ? (
                <Text style={styles.introOffer}>
                  {t('paywall.introOffer', { price: product.introductoryPriceIOS ?? '' })}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.price}>
        {catalogLoading
          ? t('paywall.loadingPrice')
          : selectedProduct?.displayPrice ?? t('paywall.catalogUnavailable')}
      </Text>

      <Pressable
        style={[
          styles.cta,
          { backgroundColor: accentMix(accent, 90), borderColor: accentMix(accent, 50) },
          (busy !== null || hasPremium || !catalogReady) && styles.ctaDisabled,
        ]}
        onPress={handlePurchase}
        disabled={busy !== null || hasPremium || !catalogReady}
        accessibilityRole="button"
        testID={`${testID}-purchase`}
      >
        {busy === 'purchase' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.ctaText}>
            {hasPremium ? t('paywall.active') : t('paywall.cta')}
          </Text>
        )}
      </Pressable>

      {showRestore ? (
        <>
          <Pressable
            style={styles.restore}
            onPress={handleRestore}
            disabled={busy !== null}
            accessibilityRole="button"
            testID={`${testID}-restore`}
          >
            {busy === 'restore' ? (
              <ActivityIndicator color={accent} />
            ) : (
              <Text style={[styles.restoreText, { color: accent }]}>{t('paywall.restore')}</Text>
            )}
          </Pressable>
          <Pressable
            style={styles.restore}
            onPress={() => setRedeemOpen(true)}
            disabled={busy !== null}
            accessibilityRole="button"
            testID={`${testID}-redeem`}
          >
            <Text style={[styles.restoreText, { color: accent }]}>{t('paywall.redeemAction')}</Text>
          </Pressable>
          <Modal
            visible={redeemOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setRedeemOpen(false)}
          >
            <View style={styles.redeemModalRoot}>
              <Pressable style={styles.redeemBackdrop} onPress={() => setRedeemOpen(false)} />
              <View style={styles.redeemCard} testID="paywall-redeem-modal">
                <Text style={styles.redeemTitle}>{t('paywall.redeemAction')}</Text>
                <TextInput
                  style={styles.redeemInput}
                  placeholder={t('account.redeemPlaceholder')}
                  placeholderTextColor={glass.textTertiary}
                  keyboardAppearance="dark"
                  value={promoCode}
                  onChangeText={setPromoCode}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  testID="paywall-redeem-input"
                />
                <Pressable
                  style={[styles.redeemSubmit, { backgroundColor: accentMix(accent, 30) }]}
                  onPress={() => { void handleRedeem(); }}
                  disabled={busy === 'redeem' || !promoCode.trim()}
                  testID="paywall-redeem-submit"
                >
                  {busy === 'redeem' ? (
                    <ActivityIndicator color={accent} size="small" />
                  ) : (
                    <Text style={[styles.restoreText, { color: accent }]}>{t('account.redeemCta')}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </Modal>
        </>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  body: { paddingHorizontal: 0, paddingBottom: 8, gap: 10 },
  trigger: { fontSize: 14, color: glass.textSecondary, lineHeight: 20 },
  statusLine: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  introPager: { marginBottom: 8 },
  introSlide: {
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginRight: 10,
    borderRadius: 18,
    backgroundColor: glass.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairlineStrong,
    minHeight: 140,
    justifyContent: 'center',
  },
  introTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8 },
  introBody: { color: glass.textSecondary, fontSize: 15, lineHeight: 22 },
  table: {
    backgroundColor: glass.fill,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairlineStrong,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.hairlineStrong,
  },
  rowLast: { borderBottomWidth: 0 },
  rowFree: { fontSize: 14, color: glass.textSecondary, flexShrink: 1 },
  rowPro: { fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  planChoices: { flexDirection: 'row', gap: 8 },
  planChoice: {
    flex: 1,
    minHeight: 76,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    justifyContent: 'space-between',
  },
  planChoiceTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  planChoicePrice: { fontSize: 16, fontWeight: '700' },
  introOffer: { color: glass.textTertiary, fontSize: 11 },
  price: { fontSize: 13, color: glass.textTertiary, textAlign: 'center' },
  cta: {
    height: 50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.55 },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  restore: { alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  restoreText: { fontSize: 14, fontWeight: '600' },
  redeemModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  redeemBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  redeemCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    padding: 20,
    gap: 12,
    backgroundColor: '#1A1F2B',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
  },
  redeemTitle: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  redeemInput: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: '#fff',
    backgroundColor: glass.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
  },
  redeemSubmit: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
