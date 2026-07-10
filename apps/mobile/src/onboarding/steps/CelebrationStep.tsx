import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../state/PreferencesContext';
import { accentMix } from '../../glass';
import { useTranslation, type TranslationKey } from '../../i18n';
import { MASCOTS, resolveMascot } from '../content';
import type { OnboardingRole, StepProps } from '../types';
import PrimaryButton from './PrimaryButton';

const THEME_EMOJI: Record<string, string> = { night: '🌙', day: '🌅', dusk: '🌇', forest: '🌲' };
const THEME_LABEL: Record<string, TranslationKey> = {
  night: 'onboarding.theme.night',
  day: 'onboarding.theme.day',
  dusk: 'onboarding.theme.dusk',
  forest: 'onboarding.theme.forest',
};
const ROLE_EMOJI: Record<OnboardingRole, string> = { leader: '🪝', follower: '🐑', browser: '👀' };
const ROLE_LABEL: Record<OnboardingRole, TranslationKey> = {
  leader: 'onboarding.role.leaderTitle',
  follower: 'onboarding.role.followerTitle',
  browser: 'onboarding.role.browser',
};

/** Fixed confetti specs — deterministic so there's no per-render jitter. */
const CONFETTI = [
  { left: '12%', size: 9, color: '#F5B142', dur: 2400, delay: 0 },
  { left: '26%', size: 7, color: '#FF44C4', dur: 2800, delay: 300 },
  { left: '40%', size: 8, color: '#37B6FF', dur: 2200, delay: 150 },
  { left: '54%', size: 6, color: '#FFD84D', dur: 2900, delay: 500 },
  { left: '68%', size: 9, color: '#57BE86', dur: 2500, delay: 250 },
  { left: '80%', size: 7, color: '#A97BFF', dur: 2700, delay: 50 },
  { left: '90%', size: 6, color: '#33E0D6', dur: 2300, delay: 400 },
  { left: '4%', size: 7, color: '#FFD84D', dur: 2600, delay: 600 },
] as const;

function Confetti({ spec }: { spec: (typeof CONFETTI)[number] }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(
      spec.delay,
      withRepeat(withTiming(1, { duration: spec.dur, easing: Easing.in(Easing.cubic) }), -1, false),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: v.value * 360 }, { rotate: `${v.value * 240}deg` }],
    opacity: v.value < 0.15 ? v.value / 0.15 : 1 - v.value,
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: 0,
          left: spec.left,
          width: spec.size,
          height: spec.size,
          borderRadius: 2,
          backgroundColor: spec.color,
        },
        style,
      ]}
    />
  );
}

/**
 * Shared finish screen — every onboarding branch ends here before 'done'. A
 * celebratory pop, a congrats line, a recap of what was chosen (endowment /
 * sunk-cost payoff), and one full-width CTA. No StepShell chrome — nothing left
 * to do but start.
 */
export default function CelebrationStep({ answers, onAnswer }: StepProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const pop = useSharedValue(0);
  useEffect(() => {
    pop.value = withDelay(
      80,
      withSequence(
        withTiming(1.15, { duration: 320, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 180, easing: Easing.inOut(Easing.cubic) }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const emojiStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
    opacity: pop.value === 0 ? 0 : 1,
  }));

  const chips = buildChips(answers, t);

  return (
    <View
      style={[
        styles.fill,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View style={styles.confettiLayer} pointerEvents="none">
        {CONFETTI.map((spec, i) => (
          <Confetti key={i} spec={spec} />
        ))}
      </View>
      <View style={styles.center}>
        <Animated.Text style={[styles.emoji, emojiStyle]}>🎉</Animated.Text>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t('onboarding.celebration.title')}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('onboarding.celebration.subtitle')}
        </Text>
        <View style={styles.chips}>
          {chips.map((c, i) => (
            <View key={i} style={[styles.chip, { backgroundColor: accentMix(colors.accent, 14) }]}>
              <Text style={styles.chipEmoji}>{c.emoji}</Text>
              <Text style={[styles.chipText, { color: colors.textPrimary }]}>{c.label}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.footer}>
        <PrimaryButton label={t('onboarding.celebration.cta')} onPress={() => onAnswer({})} />
      </View>
    </View>
  );
}

function buildChips(
  answers: StepProps['answers'],
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): { emoji: string; label: string }[] {
  const chips: { emoji: string; label: string }[] = [];
  const role = answers.role;
  if (role) chips.push({ emoji: ROLE_EMOJI[role], label: t(ROLE_LABEL[role]) });
  if (answers.theme && THEME_LABEL[answers.theme]) {
    chips.push({ emoji: THEME_EMOJI[answers.theme] ?? '🎨', label: t(THEME_LABEL[answers.theme]) });
  }
  if (role === 'leader' && answers.days != null) {
    chips.push({ emoji: '📅', label: t('onboarding.l2.days', { count: answers.days }) });
  } else if (role === 'follower' && answers.quiz?.F1 && answers.quiz.F2 && answers.quiz.F3) {
    const m = MASCOTS[resolveMascot(answers.quiz)];
    chips.push({ emoji: m.emoji, label: t(m.nameKey as TranslationKey) });
  }
  return chips;
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 24 },
  confettiLayer: { ...StyleSheet.absoluteFillObject },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  emoji: { fontSize: 96, textAlign: 'center' },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: 16, lineHeight: 24, textAlign: 'center', paddingHorizontal: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 17,
  },
  chipEmoji: { fontSize: 15 },
  chipText: { fontSize: 13.5, fontWeight: '600' },
  footer: { paddingTop: 8 },
});
