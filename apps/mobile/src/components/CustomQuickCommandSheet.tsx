import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import OverlaySheet from './OverlaySheet';
import { useTranslation } from '../i18n';
import { useSession } from '../state/SessionContext';
import { useTheme } from '../state/PreferencesContext';
import { glass } from '../glass';

export default function CustomQuickCommandSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { customQuickCommand, setCustomQuickCommand } = useSession();
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!visible) return;
    setLabel(customQuickCommand?.label ?? '');
    setMessage(customQuickCommand?.message ?? '');
  }, [visible, customQuickCommand]);

  async function save() {
    const command = { label: label.trim(), message: message.trim() };
    if (!command.label || !command.message) {
      Alert.alert(t('settings.customQuickCommand'), t('settings.customQuickCommandRequired'));
      return;
    }
    try {
      await setCustomQuickCommand(command);
      onClose();
    } catch {
      Alert.alert(t('settings.customQuickCommand'), t('settings.customQuickCommandSaveFailed'));
    }
  }

  return (
    <OverlaySheet
      visible={visible}
      onClose={onClose}
      title={t('settings.customQuickCommand')}
      accent={colors.accent}
      doneLabel={t('common.cancel')}
    >
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{t('settings.customQuickCommand')}</Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder={t('settings.customQuickCommandName')}
          placeholderTextColor={glass.textTertiary}
          style={styles.input}
          maxLength={18}
          accessibilityLabel={t('settings.customQuickCommandName')}
        />
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder={t('settings.customQuickCommandMessage')}
          placeholderTextColor={glass.textTertiary}
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
