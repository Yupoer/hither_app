import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useSession } from '../state/SessionContext';
import {
  usePreferences,
  useTheme,
  type Language,
} from '../state/PreferencesContext';
import { getGroupState, reorderDestinations } from '../api/client';
import DestinationReorderList from '../components/DestinationReorderList';
import { useTranslation, type TranslationKey } from '../i18n';
import { confirmAction } from '../utils/confirm';
import type { GroupState } from '../types';
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
 * map header. Lets the user edit their anonymous nickname, change UI language and
 * colour theme (persisted device-side), see and re-order the group's gathering
 * points, see the group / role / member count + code, and leave or sign out.
 *
 * Group data is fetched once on entry (a lightweight one-shot, no realtime
 * channel or poll) — Settings is a transient screen, so it avoids the extra
 * websocket the live map already maintains. It refetches after a reorder.
 */
export default function SettingsScreen({ navigation }: Props) {
  const { user, membership, leaveGroup, signOut, updateNickname } = useSession();
  const { language, themeName, setLanguage, setThemeName } = usePreferences();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const groupId = membership?.group.id ?? null;
  const isLeader = membership?.role === 'leader';

  // One-shot group state (members + itinerary). No realtime here on purpose.
  const [groupState, setGroupState] = useState<GroupState | null>(null);
  const loadGroupState = useCallback(async () => {
    if (!groupId) {
      setGroupState(null);
      return;
    }
    try {
      setGroupState(await getGroupState(groupId));
    } catch {
      // Leave whatever we had; the group section just shows dashes.
    }
  }, [groupId]);

  useEffect(() => {
    void loadGroupState();
  }, [loadGroupState]);

  const memberCount = groupState?.members.length ?? null;
  const destinations = groupState?.destinations ?? [];

  // --- Nickname editing -----------------------------------------------------
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [savingNickname, setSavingNickname] = useState(false);

  function startEditNickname() {
    setNicknameDraft(user?.name ?? '');
    setEditingNickname(true);
  }

  async function saveNickname() {
    const trimmed = nicknameDraft.trim();
    if (!trimmed) {
      Alert.alert(t('settings.nicknameEmpty'));
      return;
    }
    setSavingNickname(true);
    try {
      await updateNickname(trimmed);
      setEditingNickname(false);
    } catch {
      Alert.alert(t('settings.nicknameFailed'));
    } finally {
      setSavingNickname(false);
    }
  }

  // --- Reorder gathering points --------------------------------------------
  const handleReorder = useCallback(
    async (orderedIds: string[]) => {
      if (!groupId) return;
      try {
        const next = await reorderDestinations(groupId, orderedIds);
        setGroupState(next);
      } catch {
        Alert.alert(t('settings.reorderFailed'));
        void loadGroupState(); // restore the persisted order
      }
    },
    [groupId, loadGroupState, t],
  );

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
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('settings.nickname')}</Text>
          {editingNickname ? (
            <View style={styles.editGroup}>
              <TextInput
                style={styles.input}
                value={nicknameDraft}
                onChangeText={setNicknameDraft}
                autoFocus
                maxLength={24}
                placeholder={user?.name ?? ''}
                placeholderTextColor={colors.textSecondary}
                editable={!savingNickname}
                onSubmitEditing={saveNickname}
                returnKeyType="done"
              />
              <Pressable
                style={styles.saveBtn}
                onPress={saveNickname}
                disabled={savingNickname}
              >
                <Text style={styles.saveText}>{t('settings.save')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.editGroup}>
              <Text style={styles.rowValue}>{user?.name ?? dash}</Text>
              <Pressable style={styles.editBtn} onPress={startEditNickname}>
                <Text style={styles.editText}>{t('settings.edit')}</Text>
              </Pressable>
            </View>
          )}
        </View>
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
              />
            ))}
          </View>
        </View>
      </View>

      {/* Gathering points (re-orderable) */}
      {membership && (
        <>
          <Text style={styles.section}>{t('settings.destinationsSection')}</Text>
          <DestinationReorderList
            destinations={destinations}
            canReorder={!!isLeader}
            onReorder={handleReorder}
            colors={colors}
            emptyLabel={t('settings.noDestinations')}
            dragHint={t('settings.dragHint')}
          />
        </>
      )}

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
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  swatch?: string;
  styles: ReturnType<typeof makeStyles>;
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
    textAlign: 'right',
  },
  editGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
    maxWidth: '70%',
    justifyContent: 'flex-end',
  },
  input: {
    flexShrink: 1,
    minWidth: 120,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
  },
  editBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  editText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  saveBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  saveText: { color: colors.background, fontSize: 14, fontWeight: '700' },
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
