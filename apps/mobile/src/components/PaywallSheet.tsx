/**
 * Settings / contextual Premium paywall sheet.
 * Presentation is shared with the Store inline block via PremiumPresentation;
 * restore remains available only in this sheet context.
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
}: {
  visible: boolean;
  onClose: () => void;
  trigger?: TranslationKey;
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
            showRestore
            trigger={trigger}
            onPurchaseSuccess={onClose}
            onRestoreSuccess={onClose}
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
