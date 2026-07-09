import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../state/PreferencesContext';
import { useTranslation } from '../../i18n';
import { MASCOTS, resolveMascot } from '../content';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';

export default function MascotStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  // quiz is guaranteed complete by the time flow.ts routes here (F1->F2->F3->mascot).
  const mascotId = resolveMascot(answers.quiz ?? {});
  const mascot = MASCOTS[mascotId];

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, { duration: 450 });
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.85 + progress.value * 0.15 }],
  }));

  return (
    <StepShell
      step="mascot"
      role={answers.role}
      title={t(mascot.nameKey as never)}
      onBack={onBack}
      onSkip={onSkip}
      footer={
        <PrimaryButton
          label={t('onboarding.continue')}
          onPress={() => onAnswer({ mascot: mascotId })}
        />
      }
    >
      <Animated.View style={[styles.card, style]}>
        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.badgeText, { color: colors.accentText }]}>
            {t(mascot.nameKey as never).slice(0, 1)}
          </Text>
        </View>
        <Text style={[styles.description, { color: colors.textPrimary }]}>
          {t(mascot.descriptionKey as never)}
        </Text>
        <Text style={[styles.bestLeader, { color: colors.textSecondary }]}>
          {t(mascot.bestLeaderKey as never)}
        </Text>
      </Animated.View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', marginTop: 24 },
  badge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  badgeText: { fontSize: 36, fontWeight: '700' },
  description: { fontSize: 16, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  bestLeader: { fontSize: 14, textAlign: 'center' },
});
