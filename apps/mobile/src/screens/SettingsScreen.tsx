import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useSession } from '../state/SessionContext';
import {
  usePreferences,
  useTheme,
  type Language,
} from '../state/PreferencesContext';
import { useGroupState } from '../state/useGroupState';
import { useTranslation, type TranslationKey } from '../i18n';
import { confirmAction } from '../utils/confirm';
import {
  radius,
  spacing,
  themes,
  THEME_ORDER,
  type Palette,
  type ThemeName,
} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
];

const THEME_LABEL_KEY: Record<ThemeName, TranslationKey> = {
  night: 'settings.themeNight',
  day: 'settings.themeDay',
  dusk: 'settings.themeDusk',
};

/**
 * Profile + group + preferences settings. Reached from the gear button in the
 * map header. Shows the anonymous nickname, lets the user change UI language and
 * colour theme (persisted device-side), surfaces the current group / role /
 * member count + code, and lets them leave the group or sign out.
 */
export default function SettingsScreen({ navigation }: Props) {
  const { user, membership, leaveGroup, signOut } = useSession();
  const { language, themeName, setLanguage, setThemeName } = usePreferences();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  // Live member count for the current group (same source the map uses).
  const { state } = useGroupState(membership?.group.id ?? null);
  const memberCount = state?.members.length ?? null;

  function confirmLeave() {
    confirmAction(
      {
        title: t('group.leaveTitle'),
        message: t('group.leaveMsg'),
        confirmLabel: t('group.leaveConfirm'),
        destructive: true,
      },
      () => {
        leaveGroup();
        navigation.navigate('Group');
      },
    );
  }

  function confirmSignOut() {
    confirmAction(
      {
        title: t('settings.signOutTitle'),
        message: t('settings.signOutMsg'),
        confirmLabel: t('settings.signOut'),
        destructive: true,
      },
      () => {
        signOut();
        navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
      },
    );
  }

  const dash = t('settings.dash');

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      {/* Account */}
      <Text style={styles.section}>{t('settings.accountSection')}</Text>
      <View style={styles.card}>
        <Row label={t('settings.nickname')} value={user?.name ?? dash} />
        {user?.email ? <Row label={t('settings.email')} value={user.email} /> : null}
      </View>

      {/* Preferences: language + theme */}
      <Text style={styles.section}>{t('settings.preferencesSection')}</Text>
      <View style={styles.card}>
        <View style={styles.prefRow}>
          <Text style={styles.rowLabel}>{t('settings.language')}</Text>
          <View style={styles.choices}>
            {LANGUAGE_OPTIONS.map((opt) => (
              <Choice
                key={opt.value}
                label={opt.label}
                active={language === opt.value}
                onPress={() => setLanguage(opt.value)}
                styles={styles}
                colors={colors}
              />
            ))}
          </View>
        </View>
        <View style={[styles.prefRow, styles.prefRowLast]}>
          <Text style={styles.rowLabel}>{t('settings.theme')}</Text>
          <View style={styles.choices}>
            {THEME_ORDER.map((name) => (
              <Choice
                key={name}
                label={t(THEME_LABEL_KEY[name])}
                active={themeName === name}
                onPress={() => setThemeName(name)}
                swatch={themes[name].accent}
                styles={styles}
                colors={colors}
              />
            ))}
          </View>
        </View>
      </View>

      {/* Group */}
      <Text style={styles.section}>{t('settings.groupSection')}</Text>
      <View style={styles.card}>
        <Row
          label={t('settings.group')}
          value={membership?.group.name ?? t('settings.notInGroup')}
        />
        <Row label={t('settings.code')} value={membership?.group.inviteCode ?? dash} />
        <Row
          label={t('settings.members')}
          value={
            membership && memberCount != null
              ? t('settings.membersValue', { count: memberCount })
              : dash
          }
        />
        <Row
          label={t('settings.role')}
          value={
            membership
              ? membership.role === 'leader'
                ? t('settings.roleLeader')
                : t('settings.roleFollower')
              : dash
          }
        />
      </View>

      {membership && (
        <Pressable style={styles.dangerBtn} onPress={confirmLeave}>
          <Text style={styles.dangerText}>{t('settings.leave')}</Text>
        </Pressable>
      )}

      <Pressable style={styles.dangerBtn} onPress={confirmSignOut}>
        <Text style={styles.dangerText}>{t('settings.signOut')}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Choice({
  label,
  active,
  onPress,
  swatch,
  styles,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  swatch?: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Palette;
}) {
  return (
    <Pressable
      style={[styles.choice, active && styles.choiceActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {swatch ? (
        <View style={[styles.swatch, { backgroundColor: swatch }]} />
      ) : null}
      <Text
        style={[styles.choiceText, active && styles.choiceTextActive]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.xl, gap: spacing.sm },
  section: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
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
  rowLabel: { color: colors.textSecondary, fontSize: 14 },
  rowValue: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  prefRow: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  prefRowLast: { borderBottomWidth: 0 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  choiceActive: {
    borderColor: colors.accent,
    backgroundColor: colors.glass,
  },
  choiceText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  choiceTextActive: { color: colors.accent },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  dangerBtn: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  dangerText: { color: colors.danger, fontSize: 16, fontWeight: '700' },
});
