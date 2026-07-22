import React, { useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { HitherText } from '../../components/HitherText';
import { useTheme } from '../../state/PreferencesContext';
import { accentMix, accentOver } from '../../glass';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { QuizAnswer, StepProps, StepId } from '../types';
import { OnboardingIcons } from '../icons';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';
import { selectionTick } from '../../utils/haptics';

const IS_ANDROID = Platform.OS === 'android';

/**
 * One of the two side-by-side answers on a scenario step. Horizontal A/B pair
 * (each half-width) with a corner letter tag, a clay icon and the label; the
 * selected card gains the accent border + a soft glow (iOS only).
 *
 * Android: solid fill + padding-ring border, never elevation — avoids the dark
 * rounded “black frame” compositing artifact.
 */
function ScenarioCard({
  tag,
  icon,
  label,
  selected,
  onPress,
}: {
  tag: 'A' | 'B';
  icon: ImageSourcePropType;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const cardBg = selected
    ? IS_ANDROID
      ? accentOver(colors.accent, colors.surface, 16)
      : accentMix(colors.accent, 16)
    : colors.surface;
  const ringColor = selected ? colors.accent : colors.border;
  const ringWidth = selected ? 2 : StyleSheet.hairlineWidth * 2;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        selectionTick();
        onPress();
      }}
      // Off: no press fade / ripple — only selected vs unselected.
      android_ripple={IS_ANDROID ? { color: 'transparent' } : undefined}
      style={[
        styles.outer,
        {
          padding: ringWidth,
          backgroundColor: ringColor,
          elevation: 0,
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
          shadowColor: 'transparent',
        },
        selected && !IS_ANDROID && { ...styles.glow, shadowColor: colors.accent },
      ]}
    >
      <View
        style={[styles.card, { backgroundColor: cardBg, elevation: 0, shadowOpacity: 0 }]}
        collapsable={false}
      >
        <HitherText
          typeRole="caption"
          style={[styles.tag, { color: selected ? colors.accent : colors.textSecondary }]}
        >
          {tag}
        </HitherText>
        <Image
          source={icon}
          style={styles.icon}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <HitherText typeRole="body" style={[styles.label, { color: colors.textPrimary }]}>
          {label}
        </HitherText>
      </View>
    </Pressable>
  );
}

/**
 * Shared renderer for the three A/B personality-quiz steps (F1/F2/F3) — same
 * layout, different question/answer keys, so they don't need three near-
 * identical files. Selecting marks a card; Continue advances.
 */
function makeQuizStep(
  step: 'F1' | 'F2' | 'F3',
  n: number,
  titleKey: TranslationKey,
  aKey: TranslationKey,
  bKey: TranslationKey,
  iconA: ImageSourcePropType,
  iconB: ImageSourcePropType,
) {
  return function QuizStepImpl({ answers, onAnswer, onSkip, onBack }: StepProps) {
    const { t } = useTranslation();
    const [sel, setSel] = useState<QuizAnswer | undefined>(answers.quiz?.[step]);

    return (
      <StepShell
        step={step as StepId}
        role={answers.role}
        kicker={t('onboarding.quiz.kicker', { n })}
        title={t(titleKey)}
        onBack={onBack}
        onSkip={onSkip}
        footer={
          <PrimaryButton
            label={t('onboarding.continue')}
            disabled={!sel}
            onPress={() => sel && onAnswer({ quiz: { ...answers.quiz, [step]: sel } })}
          />
        }
      >
        <View style={styles.row}>
          <ScenarioCard tag="A" icon={iconA} label={t(aKey)} selected={sel === 'A'} onPress={() => setSel('A')} />
          <ScenarioCard tag="B" icon={iconB} label={t(bKey)} selected={sel === 'B'} onPress={() => setSel('B')} />
        </View>
      </StepShell>
    );
  };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  outer: {
    flex: 1,
    borderRadius: 22,
    // Don't clip iOS shadow; Android needs it for ripple/ring.
    ...(IS_ANDROID ? { overflow: 'hidden' as const } : null),
  },
  card: {
    minHeight: 188,
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glow: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  tag: { position: 'absolute', top: 10, left: 12, fontSize: 12, fontWeight: '800' },
  icon: { width: 92, height: 92 },
  label: { fontSize: 16.5, fontWeight: '700', marginTop: 14, textAlign: 'center' },
});

export const F1Step = makeQuizStep(
  'F1',
  1,
  'onboarding.f1.title',
  'onboarding.f1.a',
  'onboarding.f1.b',
  OnboardingIcons.ramen,
  OnboardingIcons.walk,
);
export const F2Step = makeQuizStep(
  'F2',
  2,
  'onboarding.f2.title',
  'onboarding.f2.a',
  'onboarding.f2.b',
  OnboardingIcons.map,
  OnboardingIcons.leaf,
);
export const F3Step = makeQuizStep(
  'F3',
  3,
  'onboarding.f3.title',
  'onboarding.f3.a',
  'onboarding.f3.b',
  OnboardingIcons.clock,
  OnboardingIcons.snail,
);
