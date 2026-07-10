import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../state/PreferencesContext';
import { accentMix } from '../../glass';
import { useTranslation, type TranslationKey } from '../../i18n';
import type { QuizAnswer, StepProps, StepId } from '../types';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';
import { selectionTick } from '../../utils/haptics';

/**
 * One of the two side-by-side answers on a scenario step. Horizontal A/B pair
 * (each half-width) with a corner letter tag, a big emoji and the label; the
 * selected card gains the accent border + a soft glow.
 */
function ScenarioCard({
  tag,
  emoji,
  label,
  selected,
  onPress,
}: {
  tag: 'A' | 'B';
  emoji: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        selectionTick();
        onPress();
      }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected ? accentMix(colors.accent, 16) : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
        selected && { ...styles.glow, shadowColor: colors.accent },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.tag, { color: selected ? colors.accent : colors.textSecondary }]}>
        {tag}
      </Text>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
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
  emojiA: string,
  emojiB: string,
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
          <ScenarioCard tag="A" emoji={emojiA} label={t(aKey)} selected={sel === 'A'} onPress={() => setSel('A')} />
          <ScenarioCard tag="B" emoji={emojiB} label={t(bKey)} selected={sel === 'B'} onPress={() => setSel('B')} />
        </View>
      </StepShell>
    );
  };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  card: {
    flex: 1,
    minHeight: 148,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  tag: { position: 'absolute', top: 10, left: 12, fontSize: 12, fontWeight: '800' },
  emoji: { fontSize: 42, lineHeight: 48 },
  label: { fontSize: 16.5, fontWeight: '700', marginTop: 14, textAlign: 'center' },
});

export const F1Step = makeQuizStep('F1', 1, 'onboarding.f1.title', 'onboarding.f1.a', 'onboarding.f1.b', '🍜', '🚶');
export const F2Step = makeQuizStep('F2', 2, 'onboarding.f2.title', 'onboarding.f2.a', 'onboarding.f2.b', '🗺️', '🍃');
export const F3Step = makeQuizStep('F3', 3, 'onboarding.f3.title', 'onboarding.f3.a', 'onboarding.f3.b', '⏰', '🐌');
