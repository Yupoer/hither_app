/**
 * Full-screen Premium paywall. Restore remains available only when opened
 * from Settings. Prices come from StoreKit — never hardcoded.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PremiumPresentation from './PremiumPresentation';
import { useTranslation, type TranslationKey } from '../i18n';

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
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            hitSlop={8}
            style={styles.close}
          >
            <Text style={styles.closeGlyph}>×</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{t('paywall.title')}</Text>
          <View style={styles.close} />
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
    paddingHorizontal: 8,
    paddingBottom: 8,
    minHeight: 44,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '300' },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  scroll: { paddingHorizontal: 20, paddingBottom: 32 },
});
