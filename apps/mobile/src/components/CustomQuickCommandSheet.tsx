import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import OverlaySheet from './OverlaySheet';
import { useTranslation } from '../i18n';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../state/PreferencesContext';
import { glass } from '../glass';
import { CUSTOM_QUICK_COMMAND_SLOTS } from '../types';

export default function CustomQuickCommandSheet({
  visible,
  slot,
  onClose,
}: {
  visible: boolean;
  /** Which of the account custom slots to edit (0-based). */
  slot: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { customQuickCommands, setCustomQuickCommand } = useSession();
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');

  const safeSlot = Math.max(0, Math.min(CUSTOM_QUICK_COMMAND_SLOTS - 1, slot));

  useEffect(() => {
    if (!visible) return;
    const existing = customQuickCommands[safeSlot];
    setLabel(existing?.label ?? '');
    setMessage(existing?.message ?? '');
  }, [visible, customQuickCommands, safeSlot]);

  async function save() {
    const command = { label: label.trim(), message: message.trim() };
    if (!command.label || !command.message) {
      Alert.alert(t('settings.customQuickCommand'), t('settings.customQuickCommandRequired'));
      return;
    }
    try {
      await setCustomQuickCommand(safeSlot, command);
      onClose();
    } catch (e) {
      // BUG-23: surface the real failure reason (RLS / missing column / network).
      const detail = e instanceof Error && e.message ? e.message : undefined;
      Alert.alert(
        t('settings.customQuickCommand'),
        detail ?? t('settings.customQuickCommandSaveFailed'),
      );
    }
  }

  const title =
    CUSTOM_QUICK_COMMAND_SLOTS > 1
      ? t('settings.customQuickCommandSlot', { n: String(safeSlot + 1) })
      : t('settings.customQuickCommand');

  return (
    <OverlaySheet
      visible={visible}
      onClose={onClose}
      title={title}
      accent={colors.accent}
      doneLabel={t('common.cancel')}
    >
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder={t('settings.customQuickCommandName')}
          placeholderTextColor={glass.textTertiary}
          keyboardAppearance="dark"
          style={styles.input}
          maxLength={18}
          accessibilityLabel={t('settings.customQuickCommandName')}
        />
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder={t('settings.customQuickCommandMessage')}
          placeholderTextColor={glass.textTertiary}
          keyboardAppearance="dark"
          style={[styles.input, styles.messageInput]}
          maxLength={80}
          multiline
          accessibilityLabel={t('settings.customQuickCommandMessage')}
        />
        <Pressable
          style={[styles.saveButton, { backgroundColor: colors.accent }]}
          onPress={() => void save()}
          accessibilityRole="button"
        >
          <Text style={styles.saveText}>{t('settings.customQuickCommandSave')}</Text>
        </Pressable>
      </ScrollView>
    </OverlaySheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 14 },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
    borderRadius: 14,
    backgroundColor: glass.fill,
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  messageInput: { minHeight: 100, textAlignVertical: 'top' },
  saveButton: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { color: '#0c1a12', fontSize: 16, fontWeight: '700' },
});
