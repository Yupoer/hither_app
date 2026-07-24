import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  clearUiActionFailure,
  retryLastUiAction,
  subscribeUiActionFailures,
  type UiActionFailure,
} from '../utils/uiAction';
import { useTranslation } from '../i18n';

/**
 * Root-level recovery banner for action error / timeout.
 * Offers Retry (re-run last failed runnable) and Cancel (dismiss).
 * Does not invent per-screen toast layouts — one shared surface for all
 * `runUiAction` failures (unless suppressBanner).
 */
export default function InteractionRecoveryBanner() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [failure, setFailure] = useState<UiActionFailure | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => subscribeUiActionFailures(setFailure), []);

  if (!failure) return null;

  const message =
    failure.kind === 'timeout'
      ? t('interaction.timeout')
      : t('interaction.error');

  const onCancel = () => {
    setRetrying(false);
    clearUiActionFailure();
  };

  const onRetry = () => {
    if (retrying || !failure.canRetry) return;
    setRetrying(true);
    void retryLastUiAction().finally(() => {
      setRetrying(false);
    });
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + 8 }]}
      accessibilityRole="alert"
    >
      <View style={styles.card}>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.actions}>
          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
          >
            <Text style={styles.secondaryText}>{t('common.cancel')}</Text>
          </Pressable>
          {failure.canRetry ? (
            <Pressable
              onPress={onRetry}
              disabled={retrying}
              style={({ pressed }) => [
                styles.primary,
                pressed && styles.pressed,
                retrying && styles.disabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('interaction.retry')}
              accessibilityState={{ busy: retrying, disabled: retrying }}
            >
              <Text style={styles.primaryText}>{t('interaction.retry')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 1000,
  },
  card: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(20, 26, 40, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  message: {
    flex: 1,
    color: '#F5F7FB',
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secondary: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  secondaryText: {
    color: 'rgba(245,247,251,0.9)',
    fontSize: 13,
    fontWeight: '600',
  },
  primary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F5B142',
  },
  primaryText: {
    color: '#1A1206',
    fontSize: 13,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
});
