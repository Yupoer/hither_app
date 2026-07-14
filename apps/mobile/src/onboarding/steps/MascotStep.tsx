import React, { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { HitherText } from '../../components/HitherText';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../state/PreferencesContext';
import { accentMix } from '../../glass';
import { useTranslation } from '../../i18n';
import { MASCOTS, resolveMascot } from '../content';
import { OnboardingIcons } from '../icons';
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
      kicker={t('onboarding.mascot.kicker')}
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
        <View
          style={[
            styles.slot,
            {
              backgroundColor: accentMix(colors.accent, 12),
              borderColor: accentMix(colors.accent, 45),
            },
          ]}
        >
          <Image
            source={OnboardingIcons.mascot[mascotId]}
            style={styles.art}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </View>
        <HitherText typeRole="body" style={[styles.description, { color: colors.textPrimary }]}>
          {t(mascot.descriptionKey as never)}
        </HitherText>
        <HitherText typeRole="callout" style={[styles.bestLeader, { color: colors.accent }]}>
          {t(mascot.bestLeaderKey as never)}
        </HitherText>
      </Animated.View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', marginTop: 8 },
  slot: {
    width: 210,
    height: 210,
    borderRadius: 34,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    overflow: 'hidden',
  },
  art: { width: 176, height: 176 },
  description: { fontSize: 15, fontWeight: '600', marginBottom: 6, textAlign: 'center' },
  bestLeader: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
});
