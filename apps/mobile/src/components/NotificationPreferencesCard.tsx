import { APP_TEXT_SIZE } from '../theme/typeScale';
import { useMountEffect } from '../hooks/useMountEffect';
import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { AppText as Text } from './AppText';
import SystemToggle from './SystemToggle';
import {
  getNotificationPreferences,
  setNotificationPreferences,
} from '../api/client';
import { useTranslation, type TranslationKey } from '../i18n';
import { getOperationErrorMessage } from '../utils/operationError';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationCategory,
  type NotificationPreferences,
} from '../types';
import { spacing, type Palette } from '../theme';

/**
 * Per-category notification toggles in Settings. Each of the four categories
 * (new gathering point / leader commands / member requests / journey) can be
 * switched independently.
 *
 * Preferences live server-side (`notification_preferences`) because the APNs
 * Edge Function filters recipients by them — a disabled category means the
 * server never sends that push to this user. Toggling optimistically updates
 * the UI and upserts; on failure it rolls back.
 */

const ROWS: { key: NotificationCategory; label: TranslationKey }[] = [
  { key: 'addGathering', label: 'settings.notifAddGathering' },
  { key: 'leaderCommands', label: 'settings.notifLeaderCommands' },
  { key: 'followerRequests', label: 'settings.notifFollowerRequests' },
  { key: 'journey', label: 'settings.notifJourney' },
  { key: 'arrival', label: 'settings.notifArrival' },
];

export default function NotificationPreferencesCard({
  colors,
  home = false,
}: {
  colors: Palette;
  home?: boolean;
}) {
  const { t, language } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rows = home ? [ROWS[0], ROWS[1], ROWS[2], ROWS[4], ROWS[3]] : ROWS;
  const rowLabel = (key: NotificationCategory, label: TranslationKey) => {
    if (!home) return t(label);
    if (key === 'arrival') return language === 'zh' ? '隊伍動態' : 'Team activity';
    if (key === 'journey') return language === 'zh' ? '出發與暫停' : 'Departure and pause';
    if (key === 'followerRequests') return language === 'zh' ? '成員請求' : 'Member requests';
    return t(label);
  };
  const [prefs, setPrefs] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );

  useMountEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await getNotificationPreferences();
        if (active) setPrefs(loaded);
      } catch {
        // keep defaults (all on) if the read fails
      }
    })();
    return () => {
      active = false;
    };
  });

  async function toggle(key: NotificationCategory, value: boolean) {
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next); // optimistic
    try {
      await setNotificationPreferences(next);
    } catch (error) {
      setPrefs(previous); // roll back on failure
      Alert.alert(
        t('subgroup.failed') || '設定失敗',
        getOperationErrorMessage(error, language),
      );
    }
  }

  return (
    <View style={styles.card}>
      {rows.map(({ key, label }, index) => (
        <View
          key={key}
          style={[styles.row, index === rows.length - 1 && styles.rowLast]}
        >
          <Text style={[styles.label, home && { color: "#fff", fontSize: APP_TEXT_SIZE.caption }]}>{rowLabel(key, label)}</Text>
          <SystemToggle
            testID={`notification-preference-${key}`}
            value={prefs[key]}
            onValueChange={(v) => toggle(key, v)}
            accessibilityLabel={rowLabel(key, label)}
          />
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: 'transparent',
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.md,
      paddingHorizontal: 0,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowLast: { borderBottomWidth: 0 },
    label: { color: colors.textPrimary, fontSize: APP_TEXT_SIZE.caption, flex: 1, marginEnd: spacing.sm },
  });
