import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { liquidGlass } from '../native';
import { useTheme } from '../state/PreferencesContext';
import { useTranslation } from '../i18n';
import { glass } from '../glass';
import { radius, spacing, type Palette } from '../theme';
import type { Coordinates } from '../types';
import {
  validateCoordinateDestination,
  type CoordinateDestinationInput,
  type CoordinateValidationError,
} from '../utils/coordinateDestination';

export type { CoordinateDestinationInput, CoordinateValidationError };
export { validateCoordinateDestination };

export interface CoordinateDestinationSheetProps {
  visible: boolean;
  initialCoordinates?: Coordinates;
  onClose: () => void;
  onSubmit: (input: CoordinateDestinationInput) => Promise<void>;
}

/**
 * Shared confirmation sheet for long-press map picks and manual lat/lng entry.
 * Both paths end at the same `onSubmit` → `addDestination` caller.
 */
export default React.memo(function CoordinateDestinationSheet({
  visible,
  initialCoordinates,
  onClose,
  onSubmit,
}: CoordinateDestinationSheetProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [title, setTitle] = useState('');
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');
  const [error, setError] = useState<CoordinateValidationError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setLatText(
      initialCoordinates != null ? String(initialCoordinates.latitude) : '',
    );
    setLngText(
      initialCoordinates != null ? String(initialCoordinates.longitude) : '',
    );
    setError(null);
    setSubmitting(false);
  }, [visible, initialCoordinates]);

  async function handleSubmit() {
    if (submitting) return;
    const result = validateCoordinateDestination(title, latText, lngText);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(result.input);
      onClose();
    } catch {
      // Keep fields; caller surfaces map.setFailedTitle when needed.
    } finally {
      setSubmitting(false);
    }
  }

  const errorMessage =
    error === 'empty_title'
      ? t('coord.emptyTitle')
      : error === 'invalid_coords'
        ? t('coord.invalidCoords')
        : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <liquidGlass.GlassView
          tintColor={glass.overlay}
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + spacing.lg },
          ]}
        >
          <View style={styles.handle} />
          <Text style={styles.heading}>{t('coord.title')}</Text>

          <Text style={styles.label}>{t('coord.nameLabel')}</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={t('coord.namePlaceholder')}
            placeholderTextColor={glass.textTertiary}
            keyboardAppearance="dark"
            accessibilityLabel={t('coord.nameLabel')}
            editable={!submitting}
          />

          <Text style={styles.label}>{t('coord.latLabel')}</Text>
          <TextInput
            style={styles.input}
            value={latText}
            onChangeText={setLatText}
            placeholder="25.0339"
            placeholderTextColor={glass.textTertiary}
            keyboardAppearance="dark"
            keyboardType="numbers-and-punctuation"
            accessibilityLabel={t('coord.latLabel')}
            editable={!submitting}
          />

          <Text style={styles.label}>{t('coord.lngLabel')}</Text>
          <TextInput
            style={styles.input}
            value={lngText}
            onChangeText={setLngText}
            placeholder="121.5645"
            placeholderTextColor={glass.textTertiary}
            keyboardAppearance="dark"
            keyboardType="numbers-and-punctuation"
            accessibilityLabel={t('coord.lngLabel')}
            editable={!submitting}
          />

          {errorMessage ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {errorMessage}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              style={styles.cancelBtn}
              disabled={submitting}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleSubmit()}
              style={[styles.submitBtn, submitting && styles.submitDisabled]}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting }}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>{t('coord.submit')}</Text>
              )}
            </Pressable>
          </View>
        </liquidGlass.GlassView>
      </View>
    </Modal>
  );
});

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: glass.scrim },
    sheet: {
      overflow: 'hidden',
      borderTopLeftRadius: 30,
      borderTopRightRadius: 30,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineSoft,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.sm,
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: glass.grabber,
      marginBottom: spacing.sm,
    },
    heading: {
      color: '#fff',
      fontSize: 18,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },
    label: { color: glass.textSecondary, fontSize: 13, fontWeight: '600' },
    input: {
      backgroundColor: glass.fillStrong,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineStrong,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      fontSize: 17,
      color: '#fff',
    },
    error: { color: '#ff8a80', fontSize: 14, marginTop: 4 },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.md,
      marginTop: spacing.md,
      alignItems: 'center',
    },
    cancelBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    cancelText: { color: glass.textSecondary, fontSize: 16, fontWeight: '600' },
    submitBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      minWidth: 120,
      alignItems: 'center',
    },
    submitDisabled: { opacity: 0.6 },
    submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });
