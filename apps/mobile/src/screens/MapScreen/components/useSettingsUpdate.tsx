import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useTranslation } from '../../../i18n';
import { applyOtaUpdate } from '../../../utils/otaUpdates';

const OTA_UPDATES_USABLE = !__DEV__ && Updates.isEnabled;

function SettingsOtaCheck({ onAvailable }: { onAvailable: (available: boolean) => void }) {
  useMountEffect(() => {
    if (!OTA_UPDATES_USABLE) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!cancelled) onAvailable(result.isAvailable);
      } catch {
        // A failed manual check keeps the last downloaded update state.
      }
    })();
    return () => { cancelled = true; };
  });
  return null;
}
export function useSettingsUpdate(visible: boolean) {
  const { t } = useTranslation();
  const appVersion =
    Constants.expoConfig?.version ??
    Constants.nativeAppVersion ??
    '—';

  const { isUpdateAvailable, isUpdatePending } = Updates.useUpdates();
  const [otaAvailable, setOtaAvailable] = useState(false);
  const [applyingOta, setApplyingOta] = useState(false);
  const applying = useRef(false);

  const showOtaApply =
    OTA_UPDATES_USABLE &&
    (otaAvailable || isUpdateAvailable || isUpdatePending);

  const handleApplyOta = useCallback(async () => {
    if (!OTA_UPDATES_USABLE || applying.current) return;
    applying.current = true;
    setApplyingOta(true);
    try {
      const outcome = await applyOtaUpdate({
        manual: true,
        skipCheck: isUpdatePending,
      });
      if (outcome.reloading) {
        // Process will restart; keep applying state (no false failure toast).
        return;
      }
      applying.current = false;
      setApplyingOta(false);
      if (outcome.status === 'no_update') {
        setOtaAvailable(false);
        return;
      }
      if (
        outcome.status === 'fetch_failed'
        || outcome.status === 'reload_failed'
      ) {
        Alert.alert(t('settings.otaApplyFailed'));
      }
    } catch {
      applying.current = false;
      setApplyingOta(false);
      Alert.alert(t('settings.otaApplyFailed'));
    }
  }, [isUpdatePending, t]);

  const otaSummary = useMemo(() => {
    // Expo Go / dev client: Updates may be disabled — still show a clear label.
    if (__DEV__ || !Updates.isEnabled) {
      return t('settings.otaDev');
    }
    if (Updates.isEmbeddedLaunch || !Updates.updateId) {
      return t('settings.otaEmbedded');
    }
    const shortId = Updates.updateId.replace(/-/g, '').slice(0, 8);
    return t('settings.otaUpdate', { id: shortId });
  }, [t]);
  const check = visible ? <SettingsOtaCheck onAvailable={setOtaAvailable} /> : null;
  return { appVersion, showOtaApply, applyingOta, handleApplyOta, otaSummary, check };
}
