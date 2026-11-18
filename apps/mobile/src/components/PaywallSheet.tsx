import { APP_TEXT_SIZE } from '../theme/typeScale';
/**
 * Premium paywall. Restore remains available only when opened
 * from Settings. Prices come from StoreKit — never hardcoded.
 */
import React from 'react';
import { Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from './AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PremiumPresentation from './PremiumPresentation';
import { useTranslation, type TranslationKey } from '../i18n';
import SheetHeaderAction from './SheetHeaderAction';
import SheetPresentation from './SheetPresentation';
import { MAP_SHEET_ACTION_HIT_SIZE, SHEET_CORNER_ACTION_INSET } from './mapSheetChrome';

const PAYWALL_DETENTS = [{ fraction: 0.94 }] as const;
const PAYWALL_BACKGROUND = '#071526';

export default React.memo(function PaywallSheet({
  visible,
  onClose,
  trigger,
  showRestore = true,
  onUnlockingChange,
  onEntitlementActivated,
}: {
  visible: boolean;
  onClose: () => void;
  trigger?: TranslationKey;
  showRestore?: boolean;
  onUnlockingChange?: (unlocking: boolean) => void;
  onEntitlementActivated?: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const isIOS = Platform.OS === 'ios';
  const content = (
    <View style={[styles.root, !isIOS && { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.closeSlot} />
        <Text style={styles.headerTitle}>{t('paywall.title')}</Text>
        <SheetHeaderAction
          action="close"
          onPress={onClose}
          accessibilityLabel={t('common.cancel')}
        />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps={isIOS ? "handled" : undefined}>
        {visible || isIOS ? (
          <PremiumPresentation
            showRestore={showRestore}
            showIntroPager
            trigger={trigger}
            onPurchaseSuccess={onClose}
            onRestoreSuccess={onClose}
            onEntitlementActivated={onEntitlementActivated}
            onUnlockingChange={onUnlockingChange}
            testID="paywall-premium-presentation"
          />
        ) : null}
      </ScrollView>
    </View>
  );

  if (isIOS) {
    return (
      <SheetPresentation visible={visible} onClose={onClose} detents={PAYWALL_DETENTS} backgroundColor={PAYWALL_BACKGROUND}>
        {content}
      </SheetPresentation>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {content}
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAYWALL_BACKGROUND },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SHEET_CORNER_ACTION_INSET,
    paddingTop: SHEET_CORNER_ACTION_INSET,
    paddingBottom: 8,
    minHeight: MAP_SHEET_ACTION_HIT_SIZE,
  },
  closeSlot: { width: MAP_SHEET_ACTION_HIT_SIZE, height: MAP_SHEET_ACTION_HIT_SIZE },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: APP_TEXT_SIZE.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  scroll: { paddingHorizontal: 20, paddingBottom: 32 },
});
