import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../state/PreferencesContext';
import { shade } from '../../glass';
import { HitherText } from '../../components/HitherText';
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
  background,
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
  /** Override the screen background (defaults to the active theme's). */
  background?: string;
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
        { backgroundColor: background ?? colors.background, paddingTop: insets.top + 12 },
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
            <Animated.View style={[styles.fillBar, fillStyle]}>
              <LinearGradient
                colors={[shade(colors.accent, -0.15), shade(colors.accent, 0.25)]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.fillGrad}
              />
            </Animated.View>
          </View>
        )}
        <Pressable onPress={onSkip} accessibilityRole="button" hitSlop={8}>
          <HitherText typeRole="footnote" style={[styles.skip, { color: colors.textSecondary }]}>
            {t('onboarding.skip')}
          </HitherText>
        </Pressable>
      </View>

      <View style={styles.heading}>
        {kicker ? (
          <HitherText typeRole="caption" style={[styles.kicker, { color: colors.accent }]}>
            {kicker}
          </HitherText>
        ) : null}
        <HitherText typeRole="display" style={[styles.title, { color: colors.textPrimary }]}>
          {title}
        </HitherText>
        {subtitle ? (
          <HitherText typeRole="body" style={[styles.subtitle, { color: colors.textSecondary }]}>
            {subtitle}
          </HitherText>
        ) : null}
      </View>

      <View style={styles.body}>{children}</View>
      {footer ? (
        // Lifted a whole button-height off the bottom edge so the CTA doesn't
        // hug the home indicator across every onboarding step.
        <View style={[styles.footer, { paddingBottom: insets.bottom + 72 }]}>{footer}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 40 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: { flex: 1 },
  track: { flex: 1, height: 10, borderRadius: 5, overflow: 'hidden' },
  fillBar: { height: '100%', borderRadius: 5, overflow: 'hidden' },
  fillGrad: { flex: 1, borderRadius: 5 },
  skip: { fontSize: 14, fontWeight: '600' },
  heading: { marginTop: 18, marginBottom: 18 },
  kicker: {
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  // Display-size for onboarding titles; Dynamic Type via typeRole=display (cap 1.2).
  title: { fontSize: 27, fontWeight: '800', lineHeight: 34 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 6 },
  body: { flex: 1 },
  footer: { paddingTop: 12 },
});
