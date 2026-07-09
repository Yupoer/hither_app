import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import OverlaySheet from './OverlaySheet';
import { useTranslation, type TranslationKey } from '../i18n';
import { useTheme } from '../state/PreferencesContext';
import { purchases } from '../native';
import { glass, accentMix } from '../glass';

/** Free vs Pro comparison rows, paired free/pro i18n keys per feature. */
const COMPARE_ROWS: { free: TranslationKey; pro: TranslationKey }[] = [
  { free: 'paywall.rowMembersFree', pro: 'paywall.rowMembersPro' },
  { free: 'paywall.rowAnonFree', pro: 'paywall.rowAnonPro' },
  { free: 'paywall.rowDestinationsFree', pro: 'paywall.rowDestinationsPro' },
  { free: 'paywall.rowKmlFree', pro: 'paywall.rowKmlPro' },
  { free: 'paywall.rowStragglerFree', pro: 'paywall.rowStragglerPro' },
  { free: 'paywall.rowHistoryFree', pro: 'paywall.rowHistoryPro' },
  { free: 'paywall.rowThemesFree', pro: 'paywall.rowThemesPro' },
];

/**
 * Hither Pro upsell sheet. Stacks over the map (same OverlaySheet used for
 * search / route / settings). `trigger` is an i18n key naming why the sheet
 * opened (e.g. hitting the free destinations cap); omit it for the plain
 * "upgrade" entry point in Settings.
 *
 * Purchases go through `native/purchases.ts`, which is a stub until StoreKit
 * is wired in a dev build — both actions currently resolve 'unavailable' and
 * this sheet just explains that.
 */
export default function PaywallSheet({
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
  const accent = colors.accent;
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);

  async function handlePurchase() {
    setBusy('purchase');
    try {
      const result = await purchases.purchasePro();
      if (result === 'unavailable') {
        Alert.alert(t('paywall.unavailable'));
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore() {
    setBusy('restore');
    try {
      const result = await purchases.restorePurchases();
      if (result === 'unavailable') {
        Alert.alert(t('paywall.unavailable'));
      }
    } finally {
      setBusy(null);
    }
  }

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
          style={[styles.cta, { backgroundColor: accentMix(accent, 90), borderColor: accentMix(accent, 50) }]}
          onPress={handlePurchase}
          disabled={busy !== null}
          accessibilityRole="button"
        >
          {busy === 'purchase' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>{t('paywall.cta')}</Text>
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
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 18, paddingBottom: 24, gap: 14 },
  trigger: { fontSize: 14, color: glass.textSecondary, lineHeight: 20 },
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
  ctaText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  restore: { alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  restoreText: { fontSize: 14, fontWeight: '600' },
});
