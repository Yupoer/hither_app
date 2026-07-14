import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
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
import { useFontLayout } from '../a11y/useFontScaleBucket';
import { HitherText } from './HitherText';

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
  // a11y-layout:quickCommands — column count + sizes track live font scale.
  const fontLayout = useFontLayout();
  const styles = useMemo(
    () => makeStyles(colors, fontLayout.scale, fontLayout.bucket),
    [colors, fontLayout.scale, fontLayout.bucket],
  );
  const [sending, setSending] = useState<CommandType | null>(null);

  // Role-scoped set; last slot is always the account custom command.
  // Leader keeps 9 cells (8 fixed + custom), follower keeps 4 (3 fixed + custom).
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

  const labelLines = fontLayout.bucket === 'xl' ? 2 : 1;

  return (
    <View style={styles.card}>
      <HitherText typeRole="footnote" style={styles.hint}>
        {isLeader ? t('settings.quickHintLeader') : t('settings.quickHintFollower')}
      </HitherText>
      <HitherText typeRole="caption" style={styles.customHint}>
        {t('settings.customQuickCommandEditHint')}
      </HitherText>
      <View style={styles.grid}>
        {commands.map((type) => {
          const isCustom = type === 'custom';
          const configured = isCustom && !!customQuickCommand;
          return (
            <Pressable
              key={type}
              style={[
                styles.btn,
                sending === type && styles.btnSending,
                configured && styles.btnCustomConfigured,
              ]}
              onPress={() => send(type)}
              onLongPress={isCustom ? onConfigureCustom : undefined}
              delayLongPress={350}
              disabled={!!sending}
              accessibilityRole="button"
              accessibilityLabel={
                isCustom
                  ? `${labelFor(type)}. ${t('settings.customQuickCommandEditHint')}`
                  : labelFor(type)
              }
            >
              <Ionicons
                name={COMMAND_ICON[type]}
                size={22}
                color={configured ? colors.accent : colors.textPrimary}
              />
              <HitherText
                typeRole="footnote"
                style={[styles.label, configured && styles.labelCustom]}
                numberOfLines={labelLines}
              >
                {labelFor(type)}
              </HitherText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (
  colors: Palette,
  scale: number,
  bucket: 'regular' | 'large' | 'xl',
) => {
  const s = (n: number, min = 0) => Math.max(min, Math.round(n * scale));
  // regular ≈ 3-col, large = 3-col taller, xl = 2-col.
  const flexBasis = bucket === 'xl' ? '46%' : '30%';
  const minHeight = s(bucket === 'xl' ? 72 : bucket === 'large' ? 64 : 56, 48);
  const padV = s(bucket === 'regular' ? spacing.md : spacing.lg, spacing.sm);

  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: s(spacing.md, spacing.sm),
    },
    hint: { color: colors.textSecondary, fontSize: 13 },
    customHint: { color: colors.textSecondary, fontSize: 11, opacity: 0.85 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: s(spacing.sm, 6) },
    btn: {
      flexGrow: 1,
      flexBasis,
      minHeight,
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: padV,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    btnSending: { borderColor: colors.accent, backgroundColor: colors.glass },
    btnCustomConfigured: {
      borderColor: colors.accent,
      backgroundColor: colors.glass,
    },
    label: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    labelCustom: { color: colors.accent },
  });
};
