import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../state/PreferencesContext';
import { useTranslation } from '../../i18n';
import type { StepProps } from '../types';
import PrimaryButton from './PrimaryButton';

/**
 * Shared finish screen — every onboarding branch ends here before 'done'.
 * Deliberately simple (a big emoji, a congrats line, one full-width CTA); no
 * StepShell chrome (back/skip/progress) because there is nothing left to do
 * but start. The CTA advances to 'done', which completes onboarding.
 */
export default function CelebrationStep({ onAnswer }: StepProps) {
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
      <View style={styles.center}>
        <Animated.Text style={[styles.emoji, emojiStyle]}>🎉</Animated.Text>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t('onboarding.celebration.title')}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('onboarding.celebration.subtitle')}
        </Text>
      </View>
      <View style={styles.footer}>
        <PrimaryButton label={t('onboarding.celebration.cta')} onPress={() => onAnswer({})} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  emoji: { fontSize: 104, textAlign: 'center' },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: 16, lineHeight: 24, textAlign: 'center', paddingHorizontal: 8 },
  footer: { paddingTop: 8 },
});
