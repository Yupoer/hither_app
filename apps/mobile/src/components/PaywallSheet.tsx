/**
 * Full-screen Premium paywall. Restore remains available only when opened
 * from Settings. Prices come from StoreKit — never hardcoded.
 */
import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PremiumPresentation from './PremiumPresentation';
import { useTranslation, type TranslationKey } from '../i18n';
import SheetHeaderAction from './SheetHeaderAction';
import { MAP_SHEET_ACTION_HIT_SIZE, MAP_SHEET_EDGE_INSET } from './mapSheetChrome';

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
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.closeSlot} />
          <Text style={styles.headerTitle}>{t('paywall.title')}</Text>
          <SheetHeaderAction
            action="close"
            onPress={onClose}
            accessibilityLabel={t('common.cancel')}
          />
        </View>
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
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#071526' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: MAP_SHEET_EDGE_INSET,
    paddingTop: MAP_SHEET_EDGE_INSET,
    paddingBottom: 8,
    minHeight: MAP_SHEET_ACTION_HIT_SIZE,
  },
  closeSlot: { width: MAP_SHEET_ACTION_HIT_SIZE, height: MAP_SHEET_ACTION_HIT_SIZE },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  scroll: { paddingHorizontal: 20, paddingBottom: 32 },
});
