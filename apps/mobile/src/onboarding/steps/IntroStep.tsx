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
import { useTheme } from '../../state/PreferencesContext';
import { useTranslation } from '../../i18n';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';

const DOT_COUNT = 6;
const RADIUS = 90;
const LOOP_MS = 2600;

/** One scattered dot that loops out to its spot on a ring, then gathers to center. */
function Dot({ index, color }: { index: number; color: string }) {
  const angle = (index / DOT_COUNT) * Math.PI * 2;
  const targetX = Math.cos(angle) * RADIUS;
  const targetY = Math.sin(angle) * RADIUS * 0.6; // squashed ring = "crook" arc feel

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      index * 80,
      withRepeat(
        withSequence(
          withTiming(1, { duration: LOOP_MS / 2, easing: Easing.out(Easing.cubic) }),
          withTiming(0, { duration: LOOP_MS / 2, easing: Easing.inOut(Easing.cubic) }),
        ),
        -1,
        false,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * targetX },
      { translateY: progress.value * targetY },
    ],
    opacity: 0.4 + progress.value * 0.6,
  }));

  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

export default function IntroStep({ onAnswer, onSkip }: StepProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <StepShell
      step="intro"
      role={undefined}
      title={t('onboarding.intro.title')}
      onSkip={onSkip}
      footer={<PrimaryButton label={t('onboarding.intro.start')} onPress={() => onAnswer({})} />}
    >
      <View style={styles.stage}>
        <View style={[styles.center, { backgroundColor: colors.accent }]} />
        {Array.from({ length: DOT_COUNT }).map((_, i) => (
          <Dot key={i} index={i} color={colors.textSecondary} />
        ))}
      </View>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {t('onboarding.intro.body')}
      </Text>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  stage: {
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { width: 14, height: 14, borderRadius: 7, position: 'absolute' },
  dot: { width: 10, height: 10, borderRadius: 5, position: 'absolute' },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
