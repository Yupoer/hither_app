import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import SettingsChildSheet from '../screens/MapScreen/components/SettingsChildSheet';
import { useTranslation, type TranslationKey } from '../i18n';
import { useTheme } from '../state/PreferencesContext';
import { glass, accentMix } from '../glass';
import { submitFeedback } from '../api/feedback';
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

/** Text-only feedback form, opened from Settings. */
export default function FeedbackSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
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

  async function submit() {
    if (!description.trim() || status === 'sending') return;
    await runUiAction(
      'feedback.submit',
      async (token) => {
        setStatus('sending');
        logEvent('feedback_submit', { category });
        try {
          await submitFeedback(category, description);
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
    <SettingsChildSheet
      visible={visible}
      onClose={handleClose}
      title={t('feedback.title')}
      initialStage={1}
      stageTwoRatio={0.9}
      wrapContentInScrollView={false}
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
          maxLength={2000}
          numberOfLines={5}
          textAlignVertical="top"
        />

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
    </SettingsChildSheet>
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
