import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import { createGroup, joinGroup } from '../api/client';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { confirmAction } from '../utils/confirm';
import type { Group } from '../types';
import { radius, spacing, type Palette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Group'>;

type Mode = 'choose' | 'create' | 'join';

/**
 * Create a group (becoming leader) or join one with a code (becoming
 * follower). On success the group is stored in the session and the user can
 * "Enter group" to open the map.
 */
export default function GroupScreen({ navigation }: Props) {
  const { user, membership, setMembership, leaveGroup } = useSession();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<Mode>('choose');
  const [groupName, setGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);

  const group: Group | null = membership?.group ?? null;

  async function handleCreate() {
    const name =
      groupName.trim() || t('group.defaultName', { name: user?.name ?? '' });
    setBusy(true);
    try {
      const created = await createGroup(name);
      setMembership({ group: created, role: 'leader' });
    } catch {
      Alert.alert(t('group.createFailedTitle'), t('group.createFailedMsg'));
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    const code = joinCode.trim();
    if (code.length < 4) {
      Alert.alert(t('group.codeInvalidTitle'), t('group.codeInvalidMsg'));
      return;
    }
    setBusy(true);
    try {
      const joined = await joinGroup(code);
      setMembership({ group: joined, role: 'follower' });
    } catch {
      Alert.alert(t('group.joinFailedTitle'), t('group.joinFailedMsg'));
    } finally {
      setBusy(false);
    }
  }

  function enterGroup() {
    if (group) {
      navigation.navigate('Map', { groupId: group.id });
    }
  }

  function confirmLeave() {
    // Clearing the membership drops us back to the role picker below
    // (建立 / 加入) — i.e. the identity-choosing screen.
    confirmAction(
      {
        title: t('group.leaveTitle'),
        message: t('group.leaveMsg'),
        confirmLabel: t('group.leaveConfirm'),
        destructive: true,
      },
      () => leaveGroup(),
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.greeting}>
          {t('group.greeting', { name: user?.name ?? t('group.travelerFallback') })}
        </Text>

        {/* Once in a group, show the code hero + Enter map (LOBBY screen). */}
        {group ? (
          <View style={styles.lobby}>
            <Text style={styles.label}>{t('group.codeLabel')}</Text>
            <View style={styles.codeHero}>
              <Text style={styles.codeText}>{group.inviteCode}</Text>
            </View>
            <Text style={styles.roleLine}>
              {membership?.role === 'leader'
                ? t('group.roleLeaderYou')
                : t('group.roleFollower')}
            </Text>
            <Text style={styles.hint}>{t('group.shareHint')}</Text>

            <Pressable
              style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              onPress={enterGroup}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>{t('group.enter')}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.leaveBtn,
                pressed && styles.ctaPressed,
              ]}
              onPress={confirmLeave}
              accessibilityRole="button"
            >
              <Text style={styles.leaveText}>{t('group.leave')}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Role / action picker. */}
            <View style={styles.segment}>
              <SegmentButton
                label={t('group.create')}
                sub={t('group.createSub')}
                active={mode === 'create'}
                onPress={() => setMode('create')}
              />
              <SegmentButton
                label={t('group.join')}
                sub={t('group.joinSub')}
                active={mode === 'join'}
                onPress={() => setMode('join')}
              />
            </View>

            {mode === 'create' && (
              <View style={styles.form}>
                <Text style={styles.label}>{t('group.nameLabel')}</Text>
                <TextInput
                  style={styles.input}
                  value={groupName}
                  onChangeText={setGroupName}
                  placeholder={t('group.namePlaceholder')}
                  placeholderTextColor={colors.textSecondary}
                  accessibilityLabel={t('group.nameLabel')}
                />
                <PrimaryButton
                  label={t('group.createCta')}
                  busy={busy}
                  onPress={handleCreate}
                />
              </View>
            )}

            {mode === 'join' && (
              <View style={styles.form}>
                <Text style={styles.label}>{t('group.codeOrIdLabel')}</Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={joinCode}
                  onChangeText={(t2) => setJoinCode(t2.toUpperCase())}
                  placeholder="WND482"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  accessibilityLabel={t('group.codeOrIdLabel')}
                />
                <PrimaryButton
                  label={t('group.joinCta')}
                  busy={busy}
                  onPress={handleJoin}
                />
              </View>
            )}

            {mode === 'choose' && (
              <Text style={styles.hint}>{t('group.chooseHint')}</Text>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SegmentButton({
  label,
  sub,
  active,
  onPress,
}: {
  label: string;
  sub: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
        {label}
      </Text>
      <Text style={[styles.segmentSub, active && styles.segmentSubActive]}>
        {sub}
      </Text>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  busy,
  onPress,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.cta,
        busy && styles.ctaDisabled,
        pressed && !busy && styles.ctaPressed,
      ]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
    >
      {busy ? (
        <ActivityIndicator color={colors.accentText} />
      ) : (
        <Text style={styles.ctaText}>{label}</Text>
      )}
    </Pressable>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  greeting: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  segment: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  segmentBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: 2,
  },
  segmentBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.glass,
  },
  segmentLabel: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  segmentLabelActive: { color: colors.accent },
  segmentSub: { fontSize: 12, color: colors.textSecondary },
  segmentSubActive: { color: colors.accent },
  form: { gap: spacing.sm },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.textSecondary,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 17,
    color: colors.textPrimary,
  },
  codeInput: {
    fontSize: 24,
    letterSpacing: 6,
    fontWeight: '700',
    textAlign: 'center',
  },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaPressed: { opacity: 0.85 },
  ctaText: { fontSize: 17, fontWeight: '700', color: colors.accentText },
  leaveBtn: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  leaveText: { fontSize: 15, fontWeight: '700', color: colors.danger },
  lobby: { gap: spacing.md },
  codeHero: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  codeText: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 10,
    color: colors.accent,
  },
  roleLine: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  hint: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
});
