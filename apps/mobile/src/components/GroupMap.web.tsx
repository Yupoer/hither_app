import React, { forwardRef, useImperativeHandle, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { GroupMapHandle, GroupMapProps } from './GroupMap';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { radius, spacing, type Palette } from '../theme';

/**
 * Web fallback for the native map. `react-native-maps` has no web support, so
 * Metro picks this file for the web target and the native module is never
 * imported. We render a readable list of members + the gathering point so the
 * web preview still shows live data (positions update every poll).
 *
 * The real, interactive map only runs on iOS / Android (Expo Go on a device).
 */
const GroupMap = forwardRef<GroupMapHandle, GroupMapProps>(function GroupMap(
  { members, gathering, currentUserId },
  ref,
) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useImperativeHandle(
    ref,
    () => ({ recenter: () => {}, centerOn: () => {}, fitToMembers: () => {} }),
    [],
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.note}>{t('web.note')}</Text>

      {gathering && (
        <View style={[styles.row, styles.gathering]}>
          <Text style={styles.emoji}>🚩</Text>
          <View style={styles.rowText}>
            <Text style={styles.title}>{gathering.title}</Text>
            <Text style={styles.sub}>
              {gathering.coordinates.latitude.toFixed(5)},{' '}
              {gathering.coordinates.longitude.toFixed(5)}
            </Text>
          </View>
        </View>
      )}

      <Text style={styles.section}>
        {t('web.membersSection', { count: members.length })}
      </Text>
      {members.map((m) => (
        <View key={m.userId} style={styles.row}>
          <View
            style={[
              styles.pin,
              { borderColor: m.role === 'leader' ? colors.leader : colors.follower },
            ]}
          >
            <Text style={styles.pinText}>{m.name.slice(0, 1)}</Text>
          </View>
          <View style={styles.rowText}>
            <Text style={styles.title}>
              {m.name}
              {m.userId === currentUserId ? ' · you' : ''}
            </Text>
            <Text style={styles.sub}>
              {m.role === 'leader' ? 'Leader' : 'Follower'} ·{' '}
              {m.coordinates
                ? `${m.coordinates.latitude.toFixed(5)}, ${m.coordinates.longitude.toFixed(5)}`
                : t('web.unknownLocation')}
            </Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
});

const makeStyles = (colors: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 160 },
  note: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  section: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  gathering: { borderColor: colors.accent },
  rowText: { flex: 1, gap: 2 },
  emoji: { fontSize: 28 },
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinText: { color: colors.textPrimary, fontWeight: '700' },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  sub: { color: colors.textSecondary, fontSize: 13 },
});

export default GroupMap;
