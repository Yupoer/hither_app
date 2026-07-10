import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../state/PreferencesContext';
import { useTranslation } from '../../i18n';
import type { OnboardingRole, StepId } from '../types';
import ProgressDots from './ProgressDots';

/**
 * Shared chrome for every onboarding step: back chevron, progress dots, a
 * skip link, the step title, scrollable body (children), and an optional
 * footer CTA. Swapping the whole onboarding UI later means replacing this
 * file (and the step files that use it) — the flow/content logic underneath
 * is untouched.
 */
export default function StepShell({
  step,
  role,
  title,
  onBack,
  onSkip,
  footer,
  children,
}: {
  step: StepId;
  role: OnboardingRole | undefined;
  title: string;
  onBack?: () => void;
  onSkip: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <View
      style={[
        styles.fill,
        { backgroundColor: colors.background, paddingTop: insets.top + 12 },
      ]}
    >
      <View style={styles.header}>
        {onBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <View style={styles.backSpacer} />
        )}
        <View style={styles.headerSpacer} />
        <Pressable onPress={onSkip} accessibilityRole="button" hitSlop={8}>
          <Text style={[styles.skip, { color: colors.textSecondary }]}>
            {t('onboarding.skip')}
          </Text>
        </Pressable>
      </View>
      <ProgressDots step={step} role={role} />
      <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
      <View style={styles.body}>{children}</View>
      {footer ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>{footer}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', height: 32 },
  backSpacer: { width: 22 },
  headerSpacer: { flex: 1 },
  skip: { fontSize: 14, fontWeight: '500' },
  title: { fontSize: 22, fontWeight: '700', marginTop: 8, marginBottom: 20 },
  body: { flex: 1 },
  footer: { paddingTop: 12 },
});
