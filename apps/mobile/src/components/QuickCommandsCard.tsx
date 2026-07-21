import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
// StyleSheet.hairlineWidth used in previewBtn
import { Ionicons } from '@expo/vector-icons';
import { sendCommand } from '../api/client';
import { mediumTap } from '../utils/haptics';
import { useTranslation } from '../i18n';
import {
  CUSTOM_QUICK_COMMAND_SLOTS,
  FOLLOWER_FIXED_COMMANDS,
  LEADER_COMMANDS,
  quickCommandGridItems,
  type CommandType,
  type QuickCommandGridItem,
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

/** Most-used shortcuts shown on the tools tab (not the full grid). */
const LEADER_PREVIEW: Array<Exclude<CommandType, 'custom'>> = [
  'gather',
  'find_gathering',
  'depart',
];
const FOLLOWER_PREVIEW: Array<Exclude<CommandType, 'custom'>> = [
  ...FOLLOWER_FIXED_COMMANDS,
];

/** Optional section headers for the full-sheet layout. */
type SectionKey = 'recent' | 'move' | 'safety' | 'other';

function sectionFor(type: Exclude<CommandType, 'custom'>): SectionKey {
  if (type === 'gather' || type === 'depart' || type === 'find_gathering' || type === 'hurry_up') {
    return 'move';
  }
  if (type === 'be_careful' || type === 'stop' || type === 'rest' || type === 'need_help' || type === 'need_break' || type === 'need_restroom') {
    return 'safety';
  }
  if (type === 'go_left' || type === 'go_right') return 'move';
  return 'other';
}

/**
 * Quick-notify grid. Tapping a button inserts a `command` row whose trigger
 * fans an APNs push to everyone else in the group (minus the sender).
 *
 * - `preview`: three common commands + 「全部」 entry
 * - `full`: complete role-scoped grid (for the all-commands sheet)
 */
export default function QuickCommandsCard({
  groupId,
  isLeader,
  colors,
  onConfigureCustom,
  variant = 'full',
  onOpenAll,
}: {
  groupId: string;
  isLeader: boolean;
  colors: Palette;
  onConfigureCustom: (slot: number) => void;
  variant?: 'preview' | 'full';
  onOpenAll?: () => void;
}) {
  const { t } = useTranslation();
  const { customQuickCommands } = useSession();
  // a11y-layout:quickCommands — column count + sizes track live font scale.
  const fontLayout = useFontLayout();
  const styles = useMemo(
    () => makeStyles(colors, fontLayout.scale, fontLayout.bucket, variant),
    [colors, fontLayout.scale, fontLayout.bucket, variant],
  );
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [recent, setRecent] = useState<Array<Exclude<CommandType, 'custom'>>>([]);

  const items = useMemo(() => quickCommandGridItems(isLeader), [isLeader]);

  const previewTypes = isLeader ? LEADER_PREVIEW : FOLLOWER_PREVIEW;

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

  function pushRecent(type: Exclude<CommandType, 'custom'>) {
    setRecent((prev) => {
      const next = [type, ...prev.filter((x) => x !== type)];
      return next.slice(0, 4);
    });
  }

  async function sendFixed(type: Exclude<CommandType, 'custom'>) {
    if (sendingKey) return;
    mediumTap();
    setSendingKey(`fixed:${type}`);
    const label = labelForFixed(type);
    try {
      await sendCommand(groupId, type, label);
      pushRecent(type);
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
      // Prefer short label for notification title (隊長/成員：{label});
      // fall back to message body when label is empty.
      await sendCommand(groupId, 'custom', label.trim() || message);
      Alert.alert(t('command.sent'));
    } catch {
      Alert.alert(t('command.sendFailed'));
    } finally {
      setSendingKey(null);
    }
  }

  const labelLines = fontLayout.bucket === 'xl' ? 2 : 1;

  function renderFixedBtn(type: Exclude<CommandType, 'custom'>, compact = false) {
    const key = `fixed:${type}`;
    return (
      <Pressable
        key={key}
        style={[
          compact ? styles.previewBtn : styles.btn,
          sendingKey === key && styles.btnSending,
        ]}
        onPress={() => void sendFixed(type)}
        disabled={!!sendingKey}
        accessibilityRole="button"
        accessibilityLabel={labelForFixed(type)}
      >
        <Ionicons
          name={COMMAND_ICON[type]}
          size={compact ? 20 : 22}
          color={colors.textPrimary}
        />
        <HitherText
          typeRole="footnote"
          style={styles.label}
          numberOfLines={labelLines}
        >
          {labelForFixed(type)}
        </HitherText>
      </Pressable>
    );
  }

  if (variant === 'preview') {
    return (
      <View style={styles.previewRow}>
        <View style={styles.previewBtns}>
          {previewTypes.map((type) => renderFixedBtn(type, true))}
        </View>
        <Pressable
          style={styles.allBtn}
          onPress={() => {
            mediumTap();
            onOpenAll?.();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('map.cmdAll')}
        >
          <HitherText typeRole="footnote" style={styles.allBtnText}>
            {t('map.cmdAll')}
          </HitherText>
        </Pressable>
      </View>
    );
  }

  // Full sheet: optional recent strip + role grid grouped lightly.
  const fixedItems = items.filter(
    (it): it is Extract<QuickCommandGridItem, { kind: 'fixed' }> => it.kind === 'fixed',
  );
  const customItems = items.filter(
    (it): it is Extract<QuickCommandGridItem, { kind: 'custom' }> => it.kind === 'custom',
  );

  const recentTypes = recent.filter((type) =>
    (isLeader ? LEADER_COMMANDS : FOLLOWER_FIXED_COMMANDS).includes(type as never),
  );

  const moveTypes = fixedItems
    .map((it) => it.type)
    .filter((type) => sectionFor(type) === 'move');
  const safetyTypes = fixedItems
    .map((it) => it.type)
    .filter((type) => sectionFor(type) === 'safety');
  const otherTypes = fixedItems
    .map((it) => it.type)
    .filter((type) => sectionFor(type) === 'other');

  return (
    <View style={styles.card}>
      <HitherText typeRole="footnote" style={styles.hint}>
        {t('settings.quickHintAll')}
      </HitherText>
      <HitherText typeRole="caption" style={styles.customHint}>
        {t('settings.customQuickCommandEditHint')}
      </HitherText>

      {recentTypes.length > 0 ? (
        <>
          <HitherText typeRole="caption" style={styles.sectionLabel}>
            {t('map.cmdRecent')}
          </HitherText>
          <View style={styles.grid}>
            {recentTypes.map((type) => renderFixedBtn(type))}
          </View>
        </>
      ) : null}

      {moveTypes.length > 0 ? (
        <>
          <HitherText typeRole="caption" style={styles.sectionLabel}>
            {t('map.cmdMove')}
          </HitherText>
          <View style={styles.grid}>
            {moveTypes.map((type) => renderFixedBtn(type))}
          </View>
        </>
      ) : null}

      {safetyTypes.length > 0 ? (
        <>
          <HitherText typeRole="caption" style={styles.sectionLabel}>
            {t('map.cmdSafety')}
          </HitherText>
          <View style={styles.grid}>
            {safetyTypes.map((type) => renderFixedBtn(type))}
          </View>
        </>
      ) : null}

      {otherTypes.length > 0 ? (
        <View style={styles.grid}>
          {otherTypes.map((type) => renderFixedBtn(type))}
        </View>
      ) : null}

      {customItems.length > 0 ? (
        <>
          <HitherText typeRole="caption" style={styles.sectionLabel}>
            {t('settings.customQuickCommand')}
          </HitherText>
          <View style={styles.grid}>
            {customItems.map((item) => {
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
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (
  colors: Palette,
  scale: number,
  bucket: 'regular' | 'large' | 'xl',
  variant: 'preview' | 'full',
) => {
  const s = (n: number, min = 0) => Math.max(min, Math.round(n * scale));
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
    sectionLabel: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      marginTop: 4,
    },
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
    // Preview strip
    previewRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 8,
    },
    previewBtns: {
      flex: 1,
      flexDirection: 'row',
      gap: 8,
      minWidth: 0,
    },
    previewBtn: {
      flex: 1,
      minHeight: s(52, 44),
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 8,
      paddingHorizontal: 4,
      borderRadius: radius.sm,
      // Flat — no tinted icon tile; accent only on 「全部」 CTA.
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.12)',
      backgroundColor: 'transparent',
    },
    allBtn: {
      minWidth: s(56, 48),
      paddingHorizontal: 12,
      borderRadius: radius.sm,
      borderWidth: 0,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    allBtnText: {
      color: '#1a0a00',
      fontSize: 13,
      fontWeight: '700',
    },
  });
};
