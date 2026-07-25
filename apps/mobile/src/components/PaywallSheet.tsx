import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import OverlaySheet from './OverlaySheet';
import { useTranslation, type TranslationKey } from '../i18n';
import { useTheme } from '../state/PreferencesContext';
import { useSession } from '../state/SessionContext';
import {
  applyVerifiedPurchase,
  restoreEntitlements,
} from '../api/client';
import { purchases } from '../native';
import { isVerifiedPurchase } from '../native/purchases';
import { FREE_LIMITS, SMALL_TRIP_PASS } from '../entitlements';
import { glass, accentMix } from '../glass';

/** Free vs Small Trip Pass comparison rows. */
const COMPARE_ROWS: { free: TranslationKey; pro: TranslationKey }[] = [
  { free: 'paywall.rowMembersFree', pro: 'paywall.rowMembersPro' },
  { free: 'paywall.rowDestinationsFree', pro: 'paywall.rowDestinationsPro' },
  { free: 'paywall.rowKmlFree', pro: 'paywall.rowKmlPro' },
  { free: 'paywall.rowStragglerFree', pro: 'paywall.rowStragglerPro' },
  { free: 'paywall.rowHistoryFree', pro: 'paywall.rowHistoryPro' },
  { free: 'paywall.rowThemesFree', pro: 'paywall.rowThemesPro' },
];

/**
 * Small Trip Premium Pass upsell sheet.
 *
 * Purchase path: BUILD-02 native IAP → verified outcome → server
 * apply_verified_purchase. This sheet never writes profiles.pro directly.
 * Incomplete payment / failed verification leaves Free Plan in place.
 */
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
    tripEntitlement,
    refreshEntitlement,
    refreshProfile,
  } = useSession();
  const accent = colors.accent;
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);

  const groupId = membership?.group.id;
  const memberCount = tripEntitlement?.memberCount;
  const tripApplicable =
    tripEntitlement?.tripApplicable ??
    (memberCount == null || memberCount <= SMALL_TRIP_PASS.maxMembers);
  const eligible =
    tripEntitlement?.smallTripEligible ?? (!isPro && tripApplicable);

  const statusLine = useMemo(() => {
    if (isPro && tripEntitlement?.expiresAt) {
      return t('paywall.expiresAt', {
        date: new Date(tripEntitlement.expiresAt).toLocaleDateString(),
      });
    }
    if (isPro) return t('paywall.active');
    if (!groupId) return t('paywall.needTrip');
    if (!tripApplicable) return t('paywall.notApplicableLarge');
    return t('paywall.tripApplicable');
  }, [isPro, tripEntitlement?.expiresAt, groupId, tripApplicable, t]);

  const handlePurchase = useCallback(async () => {
    if (!user) return;
    if (!groupId) {
      Alert.alert(t('paywall.title'), t('paywall.needTrip'));
      return;
    }
    if (!eligible && !isPro) {
      Alert.alert(t('paywall.title'), t('paywall.notApplicableLarge'));
      return;
    }
    setBusy('purchase');
    try {
      // BUILD-02 supplies verified outcomes. Stub returns unavailable.
      const result = await purchases.purchasePro();
      if (!isVerifiedPurchase(result)) {
        if (result.status === 'cancelled') return;
        if (result.status === 'unavailable') {
          Alert.alert(t('paywall.title'), t('paywall.unavailable'));
          return;
        }
        Alert.alert(t('paywall.title'), t('paywall.purchaseFailed'));
        return;
      }
      // BUILD-02: native verified outcome → Edge Function receipt verify + service_role grant.
      // User-JWT RPC cannot unlock Premium (service_role only).
      const applied = await applyVerifiedPurchase({
        groupId,
        transactionId: result.transactionId,
        productId: result.productId || SMALL_TRIP_PASS.productId,
      });
      if (!applied.ok) {
        const errCode = String(applied.error ?? 'unknown');
        const known = [
          'duplicate',
          'invalid',
          'expired',
          'revoked',
          'refunded',
          'not_applicable',
          'already_used',
          'verification_service_required',
          'unknown',
        ];
        const msg = known.includes(errCode)
          ? t(`paywall.error.${errCode}` as TranslationKey)
          : t('paywall.purchaseFailed');
        Alert.alert(t('paywall.title'), msg);
        // Server rejected — ensure UI stays Free.
        await refreshEntitlement(groupId);
        return;
      }
      await refreshProfile();
      await refreshEntitlement(groupId);
      Alert.alert(t('paywall.title'), t('paywall.purchaseSuccess'));
      onClose();
    } catch (e) {
      Alert.alert(
        t('paywall.title'),
        e instanceof Error ? e.message : t('paywall.purchaseFailed'),
      );
    } finally {
      setBusy(null);
    }
  }, [user, groupId, eligible, isPro, t, refreshEntitlement, refreshProfile, onClose]);

  const handleRestore = useCallback(async () => {
    setBusy('restore');
    try {
      // Native restore (BUILD-02) may return a verified purchase to re-apply.
      const nativeResult = await purchases.restorePurchases();
      if (isVerifiedPurchase(nativeResult) && groupId) {
        await applyVerifiedPurchase({
          groupId,
          transactionId: nativeResult.transactionId,
          productId: nativeResult.productId || SMALL_TRIP_PASS.productId,
        }).catch(() => undefined);
      }

      // Always restore UI from server entitlement — never local storage / stale isPro.
      const restored = await restoreEntitlements(groupId ?? null);
      await refreshProfile();
      const tripAfter = await refreshEntitlement(groupId);
      const hasPremium =
        !!restored.isPremium
        || !!restored.userPro
        || !!restored.trip?.isPremium
        || !!tripAfter?.isPremium;

      if (hasPremium) {
        Alert.alert(t('paywall.title'), t('paywall.restoreSuccess'));
        onClose();
        return;
      }
      if (nativeResult.status === 'unavailable') {
        Alert.alert(t('paywall.title'), t('paywall.unavailable'));
        return;
      }
      Alert.alert(t('paywall.title'), t('paywall.restoreNone'));
    } catch (e) {
      Alert.alert(
        t('paywall.title'),
        e instanceof Error ? e.message : t('paywall.restoreNone'),
      );
    } finally {
      setBusy(null);
    }
  }, [groupId, t, refreshEntitlement, refreshProfile, onClose]);

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
          {t('paywall.freePlanHint', {
            members: FREE_LIMITS.groupMembers,
            points: FREE_LIMITS.destinationsPerItinerary,
          })}
        </Text>

        <Text style={[styles.planLabel, { marginTop: 4 }]}>
          {t('paywall.smallTripTitle')}
        </Text>
        <Text style={styles.planHint}>
          {t('paywall.smallTripHint', {
            min: SMALL_TRIP_PASS.minMembers,
            max: SMALL_TRIP_PASS.maxMembers,
            days: SMALL_TRIP_PASS.durationDays,
            price: SMALL_TRIP_PASS.priceLabel,
          })}
        </Text>
        <Text style={[styles.statusLine, { color: accent }]}>{statusLine}</Text>

        <View style={styles.table}>
          {COMPARE_ROWS.map((row, i) => (
            <View key={row.free} style={[styles.row, i === COMPARE_ROWS.length - 1 && styles.rowLast]}>
              <Text style={styles.rowFree}>{t(row.free)}</Text>
              <Text style={[styles.rowPro, { color: accent }]}>{t(row.pro)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.price}>{t('paywall.price')}</Text>

        <Pressable
          style={[
            styles.cta,
            { backgroundColor: accentMix(accent, 90), borderColor: accentMix(accent, 50) },
            (busy !== null || isPro) && styles.ctaDisabled,
          ]}
          onPress={handlePurchase}
          disabled={busy !== null || isPro}
          accessibilityRole="button"
        >
          {busy === 'purchase' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>
              {isPro ? t('paywall.active') : t('paywall.cta')}
            </Text>
          )}
        </Pressable>

        <Pressable style={styles.restore} onPress={handleRestore} disabled={busy !== null} accessibilityRole="button">
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
