import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { sendCommand } from '../api/client';
import { useTranslation } from '../i18n';
import {
  COMMAND_ICON,
  FOLLOWER_COMMANDS,
  LEADER_COMMANDS,
  type CommandType,
} from '../types';
import { radius, spacing, type Palette } from '../theme';

/**
 * Quick-notify grid in Settings. Tapping a button inserts a `command` row,
 * whose AFTER-INSERT trigger fans an APNs push to everyone else in the group
 * (minus the sender) — see migration 20260619000000 + the send-push Edge
 * Function. The button set is role-scoped: a leader sees directives
 * (集合/找集合點/…), a follower sees requests (廁所/休息/…).
 *
 * Sending is best-effort and fire-and-forget from the UI's view: a brief
 * disabled state during the insert, then a small confirmation / error alert.
 */
export default function QuickCommandsCard({
  groupId,
  isLeader,
  colors,
}: {
  groupId: string;
  isLeader: boolean;
  colors: Palette;
}) {
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [sending, setSending] = useState<CommandType | null>(null);

  const commands: readonly CommandType[] = isLeader
    ? LEADER_COMMANDS
    : FOLLOWER_COMMANDS;

  async function send(type: CommandType) {
    if (sending) return;
    setSending(type);
    try {
      await sendCommand(groupId, type, t(`command.${type}` as const));
      Alert.alert(t('command.sent'));
    } catch {
      Alert.alert(t('command.sendFailed'));
    } finally {
      setSending(null);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.hint}>
        {isLeader ? t('settings.quickHintLeader') : t('settings.quickHintFollower')}
      </Text>
      <View style={styles.grid}>
        {commands.map((type) => (
          <Pressable
            key={type}
            style={[styles.btn, sending === type && styles.btnSending]}
            onPress={() => send(type)}
            disabled={!!sending}
            accessibilityRole="button"
            accessibilityLabel={t(`command.${type}` as const)}
          >
            <Text style={styles.icon}>{COMMAND_ICON[type]}</Text>
            <Text style={styles.label}>{t(`command.${type}` as const)}</Text>
          </Pressable>
        ))}
      </View>
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
      padding: spacing.lg,
      gap: spacing.md,
    },
    hint: { color: colors.textSecondary, fontSize: 13 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    btn: {
      flexGrow: 1,
      flexBasis: '30%',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    btnSending: { borderColor: colors.accent, backgroundColor: colors.glass },
    icon: { fontSize: 22 },
    label: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  });
