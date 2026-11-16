import { APP_TEXT_SIZE } from '../theme/typeScale';
import React, { useRef, useState } from 'react';
import { useMountEffect } from '../hooks/useMountEffect';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from './AppText';
import Pressable from './MotionPressable';
import SettingsChildSheet from '../screens/MapScreen/components/SettingsChildSheet';
import { useTranslation, type TranslationKey } from '../i18n';
import { HITHER_ACCENT } from '../theme/brand';
import { SETTINGS_SHEET_CONTENT_INSET } from './mapSheetChrome';
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
  fromSettings = false,
  onClose,
}: {
  visible: boolean;
  fromSettings?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('bug');
  const [status, setStatus] = useState<Status>('form');
  const mountedRef = useRef(true);
  const presentationRef = useRef(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useMountEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  });

  function reset() {
    setDescription('');
    setCategory('bug');
    setStatus('form');
  }

  function handleClose() {
    presentationRef.current += 1;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    reset();
    onClose();
  }

  async function submit() {
    if (!description.trim() || status === 'sending') return;
    const presentation = presentationRef.current;
    const stillPresented = () => mountedRef.current && presentationRef.current === presentation;
    await runUiAction(
      'feedback.submit',
      async (token) => {
        if (!stillPresented()) return;
        setStatus('sending');
        logEvent('feedback_submit', { category });
        try {
          await submitFeedback(category, description);
          if (!token.isCurrent()) return;
          logEvent('feedback_submit_ok', { category });
          if (!stillPresented()) return;
          setStatus('sent');
          // runUiAction clears the token before this presentation timer fires.
          if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
          closeTimerRef.current = setTimeout(() => {
            closeTimerRef.current = null;
            if (stillPresented()) handleClose();
          }, 1000);
        } catch (e) {
          logError('feedback_submit_failed', e, { category });
          if (token.isCurrent() && stillPresented()) setStatus('error');
          throw e;
        }
      },
      {
        screen: 'Feedback',
        suppressBanner: true,
        // Timeout (and errors) must leave the permanent spinner state.
        onError: () => {
          if (stillPresented()) setStatus((prev) => (prev === 'sending' ? 'error' : prev));
        },
      },
    );
  }

  return (
    <SettingsChildSheet
      visible={visible}
      testID="feedback-sheet"
      onClose={handleClose}
      navigation={fromSettings ? "child" : undefined}
      backLabel={t('common.back')}
      title={t('feedback.title')}
      titleFontSize={25}
      darkMaterial
      stageOneRatio={0.64}
      stageTwoRatio={0.88}
      wrapContentInScrollView={false}
    >
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.body, fromSettings && styles.settingsBody]}>
        <Text style={styles.categoryLabel}>{t('feedback.categoryLabel')}</Text>
        <View style={styles.categoryRow}>
          {CATEGORIES.map((c) => {
            const selected = c.key === category;
            return (
              <Pressable
                key={c.key}
                testID={`feedback-category-${c.key}`}
                onPress={() => setCategory(c.key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[
                  styles.categoryChip,
                  selected && styles.categoryChipSelected,
                ]}
              >
                <Text style={[styles.categoryChipText, selected && { color: '#fff' }]}>
                  {t(c.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          style={styles.input}
          testID="feedback-description"
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
            (!description.trim() || status === 'sending') && styles.ctaDisabled,
          ]}
          testID="feedback-submit"
          onPress={submit}
          disabled={!description.trim() || status === 'sending'}
          accessibilityRole="button"
        >
          {status === 'sending' ? (
            <ActivityIndicator accessibilityRole="progressbar" color="#fff" />
          ) : (
            <Text style={styles.ctaText}>{t('feedback.send')}</Text>
          )}
        </Pressable>
      </ScrollView>
    </SettingsChildSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 26, gap: 14 },
  settingsBody: { paddingHorizontal: SETTINGS_SHEET_CONTENT_INSET, paddingTop: 4 },
  categoryLabel: { fontSize: APP_TEXT_SIZE.body, fontWeight: '700', color: glass.textSecondary },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: {
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: glass.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
  },
  categoryChipSelected: { backgroundColor: accentMix(HITHER_ACCENT, 26), borderColor: HITHER_ACCENT },
  categoryChipText: { fontSize: APP_TEXT_SIZE.caption, fontWeight: '600', color: glass.textSecondary },
  input: {
    minHeight: 128,
    borderRadius: 20,
    padding: 14,
    color: '#fff',
    fontSize: APP_TEXT_SIZE.body,
    backgroundColor: glass.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hairline,
  },
  error: { fontSize: APP_TEXT_SIZE.caption, color: glass.danger },
  success: { fontSize: APP_TEXT_SIZE.caption, color: glass.ok },
  cta: {
    backgroundColor: HITHER_ACCENT,
    borderColor: HITHER_ACCENT,
    minHeight: 56,
    borderRadius: 28,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { textAlign: 'center', fontSize: APP_TEXT_SIZE.body, fontWeight: '700', color: '#fff' },
});
