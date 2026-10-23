import React from 'react';
import { View } from 'react-native';
import { AmicroButton } from '../../../components/AmicroButton';
import WaveLoading from '../../../components/WaveLoading';
import { type TranslationKey } from '../../../i18n';
import { useForegroundClock } from '../../../state/foregroundUi';
import { lightTap } from '../../../utils/haptics';

/**
 * Location-refresh control owns the 1 Hz cooldown clock so MapScreen is not
 * re-rendered every second while the button counts down.
 */
export const RefreshLocationsButton = React.memo(function RefreshLocationsButton({
  refreshing,
  cooldownUntil,
  accent,
  styles,
  t,
  onPress,
}: {
  refreshing: boolean;
  cooldownUntil: number;
  accent: string;
  styles: any;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onPress: () => void;
}) {
  const { now, lifecycle: clockLifecycle } = useForegroundClock(1000, cooldownUntil > Date.now());
  const remaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const cooling = remaining > 0;

  return <>
    {clockLifecycle}
    {refreshing ? (
      <View style={styles.refreshLocationsButton} accessibilityLabel={t('map.refreshLocationsA11y')}>
        <WaveLoading size="small" color={accent} />
      </View>
    ) : (
    <AmicroButton
      icon="refresh"
      mode="rotate"
      color={accent}
      style={styles.refreshLocationsButton}
      onPress={() => { lightTap(); onPress(); }}
      disabled={refreshing}
      accessibilityLabel={t('map.refreshLocationsA11y')}
      testID="map-refresh-locations"
      accessibilityHint={cooling ? t('map.refreshLocationsCooldown', { seconds: remaining }) : undefined}
    />
    )}
  </>;
});
