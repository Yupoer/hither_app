import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import {
  getNotificationPreferences,
  setNotificationPreferences,
} from '../api/client';
import { useTranslation, type TranslationKey } from '../i18n';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationCategory,
  type NotificationPreferences,
} from '../types';
import { radius, spacing, type Palette } from '../theme';

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
];

export default function NotificationPreferencesCard({
  colors,
}: {
  colors: Palette;
}) {
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [prefs, setPrefs] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );

  useEffect(() => {
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
  }, []);

  async function toggle(key: NotificationCategory, value: boolean) {
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next); // optimistic
    try {
      await setNotificationPreferences(next);
    } catch {
      setPrefs(previous); // roll back on failure
      Alert.alert(
        t('subgroup.failed') || '設定失敗',
        t('map.setFailedMsg') || '無法更新設定，請檢查網路連線後再試。'
      );
    }
  }

  return (
    <View style={styles.card}>
      {ROWS.map(({ key, label }, index) => (
        <View
          key={key}
          style={[styles.row, index === ROWS.length - 1 && styles.rowLast]}
        >
          <Text style={styles.label}>{t(label)}</Text>
          <Switch
            value={prefs[key]}
            onValueChange={(v) => toggle(key, v)}
            trackColor={{ true: colors.accent, false: colors.border }}
            accessibilityLabel={t(label)}
          />
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowLast: { borderBottomWidth: 0 },
    label: { color: colors.textPrimary, fontSize: 15 },
  });
