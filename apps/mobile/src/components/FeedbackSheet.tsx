import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import OverlaySheet from './OverlaySheet';
import { useTranslation, type TranslationKey } from '../i18n';
import { useTheme } from '../state/PreferencesContext';
import { glass, accentMix } from '../glass';
import { supabase } from '../api/supabase';

type Status = 'form' | 'sending' | 'sent' | 'error';

const CONTEXT_LABELS: Record<string, TranslationKey> = {
  map: 'feedback.context_map',
  itinerary: 'feedback.context_itinerary',
  kml: 'feedback.context_kml',
  settings: 'feedback.context_settings',
};

/**
 * Report-a-problem form, opened by `FeedbackButton`. The screenshot (if any)
 * is captured by the button BEFORE this sheet opens (so it shows the actual
 * screen, not the feedback form) and handed in as `screenshotUri`.
 *
 * Upload/insert failures degrade gracefully: a failed screenshot upload just
 * sends the report without one, never blocking the report itself.
 */
export default function FeedbackSheet({
  visible,
  onClose,
  contextTag,
  screenshotUri,
}: {
  visible: boolean;
  onClose: () => void;
  contextTag: 'map' | 'itinerary' | 'kml' | 'settings';
  screenshotUri: string | null;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const accent = colors.accent;
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<Status>('form');

  function reset() {
    setDescription('');
    setStatus('form');
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function uploadScreenshot(userId: string): Promise<string | null> {
    if (!screenshotUri) return null;
    try {
      const bytes = await fetch(screenshotUri).then((r) => r.arrayBuffer());
      const path = `${userId}/${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from('feedback-screenshots')
        .upload(path, bytes, { contentType: 'image/jpeg' });
      if (error) return null;
      return path;
    } catch {
      return null;
    }
  }

  async function submit() {
    if (!description.trim()) return;
    setStatus('sending');
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) throw new Error('no session');
      const screenshotPath = await uploadScreenshot(userId);
      const { error } = await supabase.from('feedback_reports').insert({
        user_id: userId,
        context_tag: contextTag,
        description: description.trim(),
        screenshot_path: screenshotPath,
        device: {
          os: Platform.OS,
          osVersion: Platform.Version,
          appVersion: Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
        },
      });
      if (error) throw error;
      setStatus('sent');
      setTimeout(handleClose, 1000);
    } catch {
      setStatus('error');
    }
  }

  const contextKey = CONTEXT_LABELS[contextTag];

  return (
    <OverlaySheet
      visible={visible}
      onClose={handleClose}
      title={t('feedback.title')}
      accent={accent}
      doneLabel={t('common.cancel')}
    >
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.contextTag, { color: accent }]}>{t(contextKey)}</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder={t('feedback.placeholder')}
          placeholderTextColor={glass.textTertiary}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />
        <Text style={styles.hint}>{t('feedback.screenshotNote')}</Text>

        {status === 'error' && <Text style={styles.error}>{t('feedback.failed')}</Text>}
        {status === 'sent' && <Text style={styles.success}>{t('feedback.sent')}</Text>}

        <Pressable
          style={[
            styles.cta,
            { backgroundColor: accentMix(accent, 90), borderColor: accentMix(accent, 50) },
            (!description.trim() || status === 'sending') && styles.ctaDisabled,
          ]}
          onPress={submit}
          disabled={!description.trim() || status === 'sending'}
          accessibilityRole="button"
        >
          {status === 'sending' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>{t('feedback.send')}</Text>
          )}
        </Pressable>
      </ScrollView>
    </OverlaySheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 18, paddingBottom: 24, gap: 14 },
  contextTag: { fontSize: 13, fontWeight: '700' },
  input: {
    minHeight: 110,
    borderRadius: 14,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    backgroundColor: glass.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
  },
  hint: { fontSize: 12, color: glass.textTertiary },
  error: { fontSize: 13, color: glass.danger },
  success: { fontSize: 13, color: glass.ok },
  cta: {
    height: 50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
