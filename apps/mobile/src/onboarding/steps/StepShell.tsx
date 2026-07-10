import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../state/PreferencesContext';
import { useTranslation } from '../../i18n';
import { stepProgress } from '../progress';
import type { OnboardingRole, StepId } from '../types';

/**
 * Shared chrome for every onboarding step: a round back button, a continuous
 * goal-gradient progress *bar* (starts already-moving, never empty), a skip
 * link, an accent kicker + title, the scrollable body (children) and an
 * optional footer CTA. Swapping the whole onboarding UI later means replacing
 * this file (and the step files that use it) — the flow/content logic
 * underneath is untouched.
 */
export default function StepShell({
  step,
  role,
  kicker,
  title,
  subtitle,
  onBack,
  onSkip,
  footer,
  children,
}: {
  step: StepId;
  role: OnboardingRole | undefined;
  /** Small uppercase accent label above the title. */
  kicker?: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onSkip: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const { index, total } = stepProgress(step, role);
  // Goal-gradient: the bar is never empty — the first step already reads ~10%.
  const target = total > 1 ? 10 + (index / (total - 1)) * 90 : 100;
  const prog = useSharedValue(target);
  useEffect(() => {
    prog.value = withTiming(target, { duration: 450, easing: Easing.out(Easing.cubic) });
  }, [target, prog]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${prog.value}%` }));

  return (
    <View
      style={[
        styles.fill,
        { backgroundColor: colors.background, paddingTop: insets.top + 12 },
      ]}
    >
      <View style={styles.header}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            hitSlop={8}
            style={[styles.backBtn, { backgroundColor: colors.surface }]}
          >
            <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
        {step === 'intro' ? (
          <View style={styles.headerSpacer} />
        ) : (
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <Animated.View style={[styles.fillBar, { backgroundColor: colors.accent }, fillStyle]} />
          </View>
        )}
        <Pressable onPress={onSkip} accessibilityRole="button" hitSlop={8}>
          <Text style={[styles.skip, { color: colors.textSecondary }]}>
            {t('onboarding.skip')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.heading}>
        {kicker ? (
          <Text style={[styles.kicker, { color: colors.accent }]}>{kicker}</Text>
        ) : null}
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
        ) : null}
      </View>

      <View style={styles.body}>{children}</View>
      {footer ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>{footer}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 40 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: { flex: 1 },
  track: { flex: 1, height: 10, borderRadius: 5, overflow: 'hidden' },
  fillBar: { height: '100%', borderRadius: 5 },
  skip: { fontSize: 14, fontWeight: '600' },
  heading: { marginTop: 18, marginBottom: 18 },
  kicker: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  title: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 6 },
  body: { flex: 1 },
  footer: { paddingTop: 12 },
});
