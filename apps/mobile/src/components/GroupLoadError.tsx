import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTranslation } from '../i18n';
import { getOperationErrorMessage, type OperationErrorClassification } from '../utils/operationError';

export default function GroupLoadError({ error, loading, retry, color }: {
  error: OperationErrorClassification;
  loading: boolean;
  retry: () => void;
  color: string;
}) {
  const { t } = useTranslation();
  return <View accessibilityLiveRegion="polite" style={{ padding: 16, alignItems: 'center' }}>
    <Text style={{ color, textAlign: 'center' }}>{error.kind === 'unknown'
      ? t('coreData.loadFailed') : getOperationErrorMessage(error)}</Text>
    {loading ? <ActivityIndicator color={color} /> : null}
    <Pressable accessibilityRole="button" disabled={loading} onPress={retry}
      accessibilityState={{ disabled: loading, busy: loading }} style={{ padding: 12 }}>
      <Text style={{ color }}>{t('interaction.retry')}</Text>
    </Pressable>
  </View>;
}
