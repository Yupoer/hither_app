/**
 * Settings / Store Premium paywall sheet.
 * Restore remains available only when opened from Settings.
 */
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import OverlaySheet from './OverlaySheet';
import PremiumPresentation from './PremiumPresentation';
import { useTranslation, type TranslationKey } from '../i18n';
import { useTheme } from '../state/PreferencesContext';

/** Monthly/annual StoreKit paywall. Local unlocks and prices are forbidden. */
export default React.memo(function PaywallSheet({
  visible,
  onClose,
  trigger,
  showRestore = true,
  onUnlockingChange,
}: {
  visible: boolean;
  onClose: () => void;
  trigger?: TranslationKey;
  showRestore?: boolean;
  onUnlockingChange?: (unlocking: boolean) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const accent = colors.accent;

  return (
    <OverlaySheet
      visible={visible}
      onClose={onClose}
      title={t('paywall.title')}
      accent={accent}
      doneLabel={t('common.cancel')}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        {visible ? (
          <PremiumPresentation
            showRestore={showRestore}
            showIntroPager
            trigger={trigger}
            onPurchaseSuccess={onClose}
            onRestoreSuccess={onClose}
            onUnlockingChange={onUnlockingChange}
            testID="paywall-premium-presentation"
          />
        ) : null}
      </ScrollView>
    </OverlaySheet>
  );
});

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 18, paddingBottom: 24 },
});
