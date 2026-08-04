import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import OverlaySheet from './OverlaySheet';
import { useTranslation, type TranslationKey } from '../i18n';
import { useTheme } from '../state/PreferencesContext';
import { useSession } from '../state/SessionContext';
import {
  loadPremiumStoreProducts,
  purchasePremiumSubscription,
  restorePremiumSubscription,
} from '../services/premiumPurchaseFlow';
import { PREMIUM_CATALOG, premiumProductForPlan, type PremiumPlan } from '../premiumCatalog';
import { FREE_LIMITS } from '../entitlements';
import { glass, accentMix } from '../glass';
import {
  hasEligibleIntroductoryOffer,
  type PremiumStoreProduct,
} from '../native/purchases';

/** Free vs account-owned auto-renewable Premium comparison rows. */
const COMPARE_ROWS: { free: TranslationKey; pro: TranslationKey }[] = [
  { free: 'paywall.rowMembersFree', pro: 'paywall.rowMembersPro' },
  { free: 'paywall.rowDestinationsFree', pro: 'paywall.rowDestinationsPro' },
  { free: 'paywall.rowKmlFree', pro: 'paywall.rowKmlPro' },
  { free: 'paywall.rowStragglerFree', pro: 'paywall.rowStragglerPro' },
  { free: 'paywall.rowHistoryFree', pro: 'paywall.rowHistoryPro' },
  { free: 'paywall.rowThemesFree', pro: 'paywall.rowThemesPro' },
];

function productForPlan(
  products: readonly PremiumStoreProduct[],
  plan: PremiumPlan,
): PremiumStoreProduct | null {
  const config = premiumProductForPlan(plan);
  return config ? products.find((product) => product.id === config.productId) ?? null : null;
}

/** Monthly/annual StoreKit paywall. Local unlocks and prices are forbidden. */
export default React.memo(function PaywallSheet({
  visible,
  onClose,
  trigger,
}: {
  visible: boolean;
  onClose: () => void;
  trigger?: TranslationKey;
}) {
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
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PremiumPlan>('monthly');
  const [products, setProducts] = useState<PremiumStoreProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
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
  }, [visible]);

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
      const result = await purchasePremiumSubscription(selectedPlan);
      if (!result.ok) {
        if (result.error === 'cancelled') return;
        if (result.error === 'pending') {
          Alert.alert(t('paywall.title'), t('paywall.pending'));
          return;
        }
        Alert.alert(t('paywall.title'), t('paywall.purchaseFailed'));
        return;
      }
      await refreshProfile();
      await refreshEntitlement(groupId);
      Alert.alert(t('paywall.title'), t('paywall.purchaseSuccess'));
      onClose();
    } catch {
      Alert.alert(t('paywall.title'), t('paywall.purchaseFailed'));
    } finally {
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
    onClose,
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
        onClose();
        return;
      }
      if (restored.error === 'projection_unavailable' || restored.error === 'verification_service_unavailable') {
        Alert.alert(t('paywall.title'), t('paywall.unavailable'));
        return;
      }
      Alert.alert(t('paywall.title'), t('paywall.restoreNone'));
    } catch {
      Alert.alert(t('paywall.title'), t('paywall.restoreNone'));
    } finally {
      setBusy(null);
    }
  }, [user, groupId, t, refreshEntitlement, refreshProfile, onClose]);

  return (
    <OverlaySheet
      visible={visible}
      onClose={onClose}
      title={t('paywall.title')}
      accent={accent}
      doneLabel={t('common.cancel')}
    >
      <ScrollView contentContainerStyle={styles.body}>
        {trigger && <Text style={styles.trigger}>{t(trigger)}</Text>}

        <Text style={styles.planLabel}>{t('paywall.freePlanTitle')}</Text>
        <Text style={styles.planHint}>
          {t('paywall.freePlanHint', { members: FREE_LIMITS.groupMembers, points: '∞' })}
        </Text>

        <Text style={[styles.planLabel, { marginTop: 4 }]}>{t('paywall.premiumTitle')}</Text>
        <Text style={styles.planHint}>{t('paywall.premiumHint')}</Text>
        <Text style={[styles.statusLine, { color: accent }]}>{statusLine}</Text>

        <View style={styles.table}>
          {COMPARE_ROWS.map((row, i) => (
            <View key={row.free} style={[styles.row, i === COMPARE_ROWS.length - 1 && styles.rowLast]}>
              <Text style={styles.rowFree}>{t(row.free)}</Text>
              <Text style={[styles.rowPro, { color: accent }]}>{t(row.pro)}</Text>
            </View>
          ))}
        </View>

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
          {catalogLoading ? t('paywall.loadingPrice') : selectedProduct?.displayPrice ?? t('paywall.catalogUnavailable')}
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
        >
          {busy === 'purchase' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>
              {hasPremium ? t('paywall.active') : t('paywall.cta')}
            </Text>
          )}
        </Pressable>

        <Pressable
          style={styles.restore}
          onPress={handleRestore}
          disabled={busy !== null}
          accessibilityRole="button"
        >
          {busy === 'restore' ? (
            <ActivityIndicator color={accent} />
          ) : (
            <Text style={[styles.restoreText, { color: accent }]}>{t('paywall.restore')}</Text>
          )}
        </Pressable>
      </ScrollView>
    </OverlaySheet>
  );
});

const styles = StyleSheet.create({
  body: { paddingHorizontal: 18, paddingBottom: 24, gap: 10 },
  trigger: { fontSize: 14, color: glass.textSecondary, lineHeight: 20 },
  planLabel: { fontSize: 14, fontWeight: '700', color: '#fff' },
  planHint: { fontSize: 13, color: glass.textSecondary, lineHeight: 18 },
  statusLine: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
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
});
