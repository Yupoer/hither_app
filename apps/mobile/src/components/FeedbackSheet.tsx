import React, { useEffect, useRef, useState } from 'react';
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
import { logEvent, logError } from '../utils/activityLog';
import { runUiAction } from '../utils/uiAction';

type Status = 'form' | 'sending' | 'sent' | 'error';

type Category = 'bug' | 'suggestion' | 'ui' | 'other';

// Category doubles as the stored `context_tag` (settings is now the only entry
// point, so the column carries the user-picked category instead of a screen).
const CATEGORIES: { key: Category; label: TranslationKey }[] = [
  { key: 'bug', label: 'feedback.cat_bug' },
  { key: 'suggestion', label: 'feedback.cat_suggestion' },
  { key: 'ui', label: 'feedback.cat_ui' },
  { key: 'other', label: 'feedback.cat_other' },
];

/**
 * Report-a-problem form, opened from the Settings overlay. The screenshot (if
 * any) is captured BEFORE this sheet opens (so it shows the actual screen, not
 * the feedback form) and handed in as `screenshotUri`.
 *
 * Upload/insert failures degrade gracefully: a failed screenshot upload just
 * sends the report without one, never blocking the report itself.
 */
export default function FeedbackSheet({
  visible,
  onClose,
  screenshotUri,
}: {
  visible: boolean;
  onClose: () => void;
  screenshotUri: string | null;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const accent = colors.accent;
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('bug');
  const [status, setStatus] = useState<Status>('form');
  const mountedRef = useRef(true);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  function reset() {
    setDescription('');
    setCategory('bug');
    setStatus('form');
  }

  function handleClose() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
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
    if (!description.trim() || status === 'sending') return;
    await runUiAction(
      'feedback.submit',
      async (token) => {
        setStatus('sending');
        logEvent('feedback_submit', { category });
        try {
          const { data } = await supabase.auth.getSession();
          if (!token.isCurrent()) return;
          const userId = data.session?.user?.id;
          if (!userId) throw new Error('no session');
          const screenshotPath = await uploadScreenshot(userId);
          if (!token.isCurrent()) return;
          const { error } = await supabase.from('feedback_reports').insert({
            user_id: userId,
            context_tag: category,
            description: description.trim(),
            screenshot_path: screenshotPath,
            // Device metadata only — no tokens, coords, or raw stacks.
            device: {
              os: Platform.OS,
              osVersion: Platform.Version,
              appVersion:
                Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
            },
          });
          if (error) throw error;
          if (!token.isCurrent()) return;
          logEvent('feedback_submit_ok', { category });
          setStatus('sent');
          // Token is cleared in runUiAction finally after success — do not gate
          // deferred close on isCurrent(). Use mount lifetime instead.
          if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
          closeTimerRef.current = setTimeout(() => {
            closeTimerRef.current = null;
            if (mountedRef.current) handleClose();
          }, 1000);
        } catch (e) {
          logError('feedback_submit_failed', e, { category });
          if (token.isCurrent()) setStatus('error');
          throw e;
        }
      },
      {
        screen: 'Feedback',
        suppressBanner: true,
        // Timeout (and errors) must leave the permanent spinner state.
        onError: () => {
          setStatus((prev) => (prev === 'sending' ? 'error' : prev));
        },
      },
    );
  }

  return (
    <OverlaySheet
      visible={visible}
      onClose={handleClose}
      title={t('feedback.title')}
      accent={accent}
      doneLabel={t('common.cancel')}
    >
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.categoryLabel}>{t('feedback.categoryLabel')}</Text>
        <View style={styles.categoryRow}>
          {CATEGORIES.map((c) => {
            const selected = c.key === category;
            return (
              <Pressable
                key={c.key}
                onPress={() => setCategory(c.key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[
                  styles.categoryChip,
                  selected && { backgroundColor: accentMix(accent, 26), borderColor: accent },
                ]}
              >
                <Text style={[styles.categoryChipText, selected && { color: accent }]}>
                  {t(c.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder={t('feedback.placeholder')}
          placeholderTextColor={glass.textTertiary}
          keyboardAppearance="dark"
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
  categoryLabel: { fontSize: 13, fontWeight: '700', color: glass.textSecondary },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: glass.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
  },
  categoryChipText: { fontSize: 14, fontWeight: '600', color: glass.textSecondary },
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
