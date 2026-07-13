import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sendCommand } from '../api/client';
import { notifications } from '../native';
import { mediumTap } from '../utils/haptics';
import { useTranslation } from '../i18n';
import {
  commandTypesWithCustomSlot,
  FOLLOWER_COMMANDS,
  LEADER_COMMANDS,
  type CommandType,
} from '../types';
import { radius, spacing, type Palette } from '../theme';
import { useSession } from '../state/SessionContext';

/**
 * Vector-icon per command (replaces the old emoji glyphs, which rendered as "?"
 * tofu on some devices). Names are from Ionicons.
 */
const COMMAND_ICON: Record<CommandType, keyof typeof Ionicons.glyphMap> = {
  gather: 'people',
  find_gathering: 'location',
  depart: 'walk',
  rest: 'cafe',
  be_careful: 'warning',
  go_left: 'arrow-back',
  go_right: 'arrow-forward',
  stop: 'hand-left',
  hurry_up: 'flash',
  need_restroom: 'body',
  need_break: 'pause',
  need_help: 'help-buoy',
  found_something: 'search',
  custom: 'create-outline',
};

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
  onConfigureCustom,
}: {
  groupId: string;
  isLeader: boolean;
  colors: Palette;
  onConfigureCustom: () => void;
}) {
  const { t } = useTranslation();
  const { customQuickCommand } = useSession();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [sending, setSending] = useState<CommandType | null>(null);

  const roleCommands = isLeader ? LEADER_COMMANDS : FOLLOWER_COMMANDS;
  const commands = commandTypesWithCustomSlot(roleCommands) as CommandType[];

  function labelFor(type: CommandType): string {
    return type === 'custom'
      ? customQuickCommand?.label ?? t('settings.customQuickCommand')
      : t(`command.${type}` as const);
  }

  async function send(type: CommandType) {
    if (sending) return;
    if (type === 'custom' && !customQuickCommand) {
      onConfigureCustom();
      return;
    }
    mediumTap(); // confirm the tap landed before the network round-trip
    setSending(type);
    const label = labelFor(type);
    const message = type === 'custom' ? customQuickCommand?.message ?? label : label;
    try {
      // Self-notify: fire a local notification on THIS device immediately, so a
      // tap is visible right away ("notify myself" simulation) without waiting
      // on the realtime → APNs round-trip (the sender is otherwise skipped).
      await notifications.requestPermission();
      await notifications.scheduleLocalNotification({
        title: isLeader
          ? t('notif.leaderTitle', { label })
          : t('notif.memberTitle', { label }),
        body: message,
        data: { type, groupId, selfNotify: true },
      });
      // Still propagate to the rest of the group (best-effort).
      await sendCommand(groupId, type, message);
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
            accessibilityLabel={labelFor(type)}
          >
            <Ionicons
              name={COMMAND_ICON[type]}
              size={22}
              color={colors.textPrimary}
            />
            <Text style={styles.label}>{labelFor(type)}</Text>
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
