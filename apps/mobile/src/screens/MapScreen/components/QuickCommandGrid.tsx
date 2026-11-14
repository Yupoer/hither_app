import { APP_TEXT_SIZE } from '../../../theme/typeScale';
import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '../../../components/AppText';
import Pressable from '../../../components/MotionPressable';
import { Ionicons } from '@expo/vector-icons';
import { requestGatheringStart, sendCommand } from '../../../api/client';
import { useMountEffect } from '../../../hooks/useMountEffect';
import { useTranslation } from '../../../i18n';
import { useSession } from '../../../state/SessionContext';
import { FOLLOWER_COMMANDS, type CommandType } from '../../../types';
import { mediumTap } from '../../../utils/haptics';
import { getOperationErrorMessage } from '../../../utils/operationError';
import SheetHeaderAction from '../../../components/SheetHeaderAction';
import { MAP_SHEET_ACTION_HIT_SIZE } from '../../../components/mapSheetChrome';

const LEADER_GRID = [
  'gather', 'find_gathering', 'depart',
  'rest', 'be_careful', 'stop',
  'hurry_up', 'go_left', 'go_right',
] satisfies readonly CommandType[];
const MEMBER_GRID = [...FOLLOWER_COMMANDS, 'find_gathering'] satisfies readonly CommandType[];
const CONFIRMATION_MS = 380;

type GridCommand = {
  key: string;
  type: CommandType;
  label: string;
  message: string;
  customSlot?: number;
};
type Draft = { slot: number; text: string };
type CommandProgress =
  | { kind: 'idle' }
  | { kind: 'sending'; key: string }
  | { kind: 'sent'; key: string }
  | { kind: 'saving' };

export function QuickCommandGrid({
  groupId,
  isLeader,
  accent,
  onAccent,
  requestStartDestinationId,
  onCommandSent,
  onClose,
}: {
  groupId: string;
  isLeader: boolean;
  accent: string;
  onAccent: string;
  requestStartDestinationId?: string;
  onCommandSent: (label: string) => void;
  onClose: () => void;
}) {
  const { t, language } = useTranslation();
  const { customQuickCommands, setCustomQuickCommand } = useSession();
  const [progress, setProgress] = useState<CommandProgress>({ kind: 'idle' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress.kind !== 'idle';
  const busyRef = useRef(false);
  const activeRef = useRef(false);
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextSlot = customQuickCommands.findIndex(command => command === null);

  useMountEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
    };
  });

  const items = (isLeader ? LEADER_GRID : MEMBER_GRID).map<GridCommand>(type => {
    const label = t(`command.${type}`);
    return {
      key: type,
      type: !isLeader && type === 'find_gathering' ? 'custom' : type,
      label,
      message: label,
    };
  });
  customQuickCommands.forEach((command, slot) => {
    if (command) items.push({ ...command, key: `custom-${slot}`, type: 'custom', customSlot: slot });
  });

  async function send(command: GridCommand) {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setProgress({ kind: 'sending', key: command.key });
    mediumTap();
    try {
      if (command.type === 'request_start' && requestStartDestinationId) {
        await requestGatheringStart(groupId, requestStartDestinationId);
      } else {
        await sendCommand(groupId, command.type, command.message);
      }
    } catch (error) {
      if (!activeRef.current) return;
      busyRef.current = false;
      setProgress({ kind: 'idle' });
      setError(getOperationErrorMessage(error, language));
      return;
    }
    if (!activeRef.current) return;
    setProgress({ kind: 'sent', key: command.key });
    confirmationTimer.current = setTimeout(() => {
      confirmationTimer.current = null;
      onCommandSent(command.label);
      onClose();
      busyRef.current = false;
      setProgress({ kind: 'idle' });
    }, CONFIRMATION_MS);
  }

  function edit(slot: number) {
    setError(null);
    setDraft({ slot, text: customQuickCommands[slot]?.label ?? '' });
    mediumTap();
  }

  async function save() {
    const text = draft?.text.trim();
    if (!draft || !text || busyRef.current) return;
    busyRef.current = true;
    setProgress({ kind: 'saving' });
    setError(null);
    try {
      const existing = customQuickCommands[draft.slot];
      const message = existing && existing.message !== existing.label ? existing.message : text;
      await setCustomQuickCommand(draft.slot, { label: text, message });
      if (activeRef.current) setDraft(null);
    } catch (error) {
      if (activeRef.current) setError(getOperationErrorMessage(error, language));
    } finally {
      busyRef.current = false;
      if (activeRef.current) setProgress({ kind: 'idle' });
    }
  }

  return (
    <View style={styles.body} testID="d6-quick-commands">
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.heading} numberOfLines={2}>
          {draft ? t('settings.customQuickCommandName') : t('d6.command.title')}
        </Text>
        <SheetHeaderAction
          action={draft ? 'commit' : 'close'}
          accessibilityLabel={draft ? t('settings.customQuickCommandSave') : t('common.close')}
          onPress={draft ? () => void save() : onClose}
          disabled={draft ? busy || !draft.text.trim() : false}
          testID={draft ? 'custom-command-save' : 'd6-command-close'}
        />
      </View>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.grid}>
        {items.map(command => {
          const sent = progress.kind === 'sent' && progress.key === command.key;
          const sending = progress.kind === 'sending' && progress.key === command.key;
          const slot = command.customSlot;
          return (
            <Pressable
              key={command.key}
              accessibilityLabel={command.label}
              accessibilityHint={slot === undefined ? undefined : t('settings.customQuickCommandEditHint')}
              accessibilityRole="button"
              accessibilityState={{ busy: sending, disabled: busy }}
              accessibilityActions={slot === undefined ? undefined : [{ name: 'longpress', label: t('d6.command.edit') }]}
              onAccessibilityAction={slot === undefined ? undefined : event => {
                if (!busyRef.current && event.nativeEvent.actionName === 'longpress') edit(slot);
              }}
              testID={`quick-command-${command.key}`}
              style={[styles.tile, sent && { backgroundColor: accent }]}
              onPress={() => void send(command)}
              onLongPress={slot === undefined ? undefined : () => edit(slot)}
              delayLongPress={350}
              disabled={busy}
            >
              {sent ? <Ionicons name="checkmark" color={onAccent} size={22} /> : (
                <Text style={styles.label}>{command.label}</Text>
              )}
            </Pressable>
          );
        })}
        {draft === null && nextSlot >= 0 ? (
          <Pressable
            style={[styles.tile, styles.add]}
            onPress={() => edit(nextSlot)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('d6.command.add')}
            accessibilityState={{ disabled: busy }}
            testID="d6-command-add"
          >
            <Ionicons name="add" size={22} color={white} />
          </Pressable>
        ) : null}
      </View>
      {draft && (
        <View style={styles.editor}>
          <TextInput
            autoFocus
            value={draft.text}
            onChangeText={text => setDraft({ slot: draft.slot, text })}
            placeholder={t('d6.command.placeholder')}
            placeholderTextColor="rgba(255,255,255,0.5)"
            accessibilityLabel={t('settings.customQuickCommandName')}
            style={styles.input}
            returnKeyType="done"
            keyboardAppearance="dark"
            maxLength={18}
            editable={!busy}
            onSubmitEditing={() => void save()}
            testID="custom-command-label"
          />
          <SheetHeaderAction
            action="close"
            onPress={() => { setDraft(null); setError(null); }}
            disabled={busy}
            accessibilityLabel={t('common.cancel')}
            testID="custom-command-cancel"
          />
        </View>
      )}
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      </ScrollView>
    </View>
  );
}

const white = '#FFFFFF';
const soft = 'rgba(255,255,255,0.1)';

const styles = StyleSheet.create({
  body: { gap: 10, flexShrink: 1, minHeight: 0 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heading: { flex: 1, minHeight: MAP_SHEET_ACTION_HIT_SIZE, textAlignVertical: 'center', paddingVertical: 13, color: white, fontSize: APP_TEXT_SIZE.body, fontWeight: '700' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: '1.9%', rowGap: 8 },
  tile: { width: '32%', minHeight: 52, borderRadius: 16, backgroundColor: soft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, paddingVertical: 9 },
  label: { color: white, fontSize: APP_TEXT_SIZE.caption, fontWeight: '600', textAlign: 'center' },
  add: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.3)', borderWidth: 1, borderStyle: 'dashed' },
  editor: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  input: { flex: 1, minHeight: 50, borderRadius: 15, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: soft, color: white, fontSize: APP_TEXT_SIZE.caption },
  error: { color: '#FF6B6B', fontSize: APP_TEXT_SIZE.caption },
});
