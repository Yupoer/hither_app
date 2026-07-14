import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sendCommand } from '../api/client';
import { notifications } from '../native';
import { mediumTap } from '../utils/haptics';
import { useTranslation } from '../i18n';
import {
  CUSTOM_QUICK_COMMAND_SLOTS,
  quickCommandGridItems,
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
 * Quick-notify grid. Tapping a button inserts a `command` row whose trigger
 * fans an APNs push to everyone else in the group (minus the sender) — see
 * migration 20260619000000 + the send-push Edge Function.
 *
 * Leader: fixed directives + one custom slot.
 * Follower: fixed requests + {@link CUSTOM_QUICK_COMMAND_SLOTS} custom slots.
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
  onConfigureCustom: (slot: number) => void;
}) {
  const { t } = useTranslation();
  const { customQuickCommands } = useSession();
  // a11y-layout:quickCommands — column count + sizes track live font scale.
  const fontLayout = useFontLayout();
  const styles = useMemo(
    () => makeStyles(colors, fontLayout.scale, fontLayout.bucket),
    [colors, fontLayout.scale, fontLayout.bucket],
  );
  const [sendingKey, setSendingKey] = useState<string | null>(null);

  const items = useMemo(() => quickCommandGridItems(isLeader), [isLeader]);

  function labelForFixed(type: Exclude<CommandType, 'custom'>): string {
    return t(`command.${type}` as const);
  }

  function labelForCustom(slot: number): string {
    const cmd = customQuickCommands[slot];
    if (cmd?.label) return cmd.label;
    return CUSTOM_QUICK_COMMAND_SLOTS > 1
      ? t('settings.customQuickCommandSlot', { n: String(slot + 1) })
      : t('settings.customQuickCommand');
  }

  function openEditor(slot: number) {
    mediumTap();
    onConfigureCustom(slot);
  }

  async function sendFixed(type: Exclude<CommandType, 'custom'>) {
    if (sendingKey) return;
    mediumTap();
    setSendingKey(`fixed:${type}`);
    const label = labelForFixed(type);
    try {
      await notifications.requestPermission();
      await notifications.scheduleLocalNotification({
        title: t('notif.commandTitle', { label }),
        body: label,
        data: { type, groupId, selfNotify: true },
      });
      await sendCommand(groupId, type, label);
      Alert.alert(t('command.sent'));
    } catch {
      Alert.alert(t('command.sendFailed'));
    } finally {
      setSendingKey(null);
    }
  }

  async function sendCustom(slot: number) {
    if (sendingKey) return;
    const cmd = customQuickCommands[slot];
    if (!cmd) {
      openEditor(slot);
      return;
    }
    mediumTap();
    setSendingKey(`custom:${slot}`);
    const label = cmd.label;
    const message = cmd.message;
    try {
      await notifications.requestPermission();
      await notifications.scheduleLocalNotification({
        title: t('notif.commandTitle', { label }),
        body: message,
        data: { type: 'custom', groupId, selfNotify: true, slot },
      });
      await sendCommand(groupId, 'custom', message);
      Alert.alert(t('command.sent'));
    } catch {
      Alert.alert(t('command.sendFailed'));
    } finally {
      setSendingKey(null);
    }
  }

  const labelLines = fontLayout.bucket === 'xl' ? 2 : 1;

  return (
    <View style={styles.card}>
      <HitherText typeRole="footnote" style={styles.hint}>
        {t('settings.quickHintAll')}
      </HitherText>
      <HitherText typeRole="caption" style={styles.customHint}>
        {t('settings.customQuickCommandEditHint')}
      </HitherText>
      <View style={styles.grid}>
        {items.map((item) => {
          if (item.kind === 'fixed') {
            const key = `fixed:${item.type}`;
            return (
              <Pressable
                key={key}
                style={[styles.btn, sendingKey === key && styles.btnSending]}
                onPress={() => void sendFixed(item.type)}
                disabled={!!sendingKey}
                accessibilityRole="button"
                accessibilityLabel={labelForFixed(item.type)}
              >
                <Ionicons
                  name={COMMAND_ICON[item.type]}
                  size={22}
                  color={colors.textPrimary}
                />
                <HitherText
                  typeRole="footnote"
                  style={styles.label}
                  numberOfLines={labelLines}
                >
                  {labelForFixed(item.type)}
                </HitherText>
              </Pressable>
            );
          }

          const key = `custom:${item.slot}`;
          const configured = !!customQuickCommands[item.slot];
          return (
            <Pressable
              key={key}
              style={[
                styles.btn,
                sendingKey === key && styles.btnSending,
                configured && styles.btnCustomConfigured,
              ]}
              onPress={() => void sendCustom(item.slot)}
              onLongPress={() => openEditor(item.slot)}
              delayLongPress={350}
              disabled={!!sendingKey}
              accessibilityRole="button"
              accessibilityLabel={`${labelForCustom(item.slot)}. ${t('settings.customQuickCommandEditHint')}`}
            >
              <Ionicons
                name={COMMAND_ICON.custom}
                size={22}
                color={configured ? colors.accent : colors.textPrimary}
              />
              <HitherText
                typeRole="footnote"
                style={[styles.label, configured && styles.labelCustom]}
                numberOfLines={labelLines}
              >
                {labelForCustom(item.slot)}
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
