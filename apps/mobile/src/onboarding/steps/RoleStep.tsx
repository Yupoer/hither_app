import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '../../state/PreferencesContext';
import { useTranslation } from '../../i18n';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import OptionCard from './OptionCard';
import { selectionTick } from '../../utils/haptics';

export default function RoleStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <StepShell
      step="role"
      role={answers.role}
      title={t('onboarding.role.title')}
      onBack={onBack}
      onSkip={onSkip}
    >
      <OptionCard
        emoji="🧑‍🌾"
        title={t('onboarding.role.leaderTitle')}
        subtitle={t('onboarding.role.leaderBody')}
        selected={answers.role === 'leader'}
        onPress={() => onAnswer({ role: 'leader' })}
      />
      <OptionCard
        emoji="🐑"
        title={t('onboarding.role.followerTitle')}
        subtitle={t('onboarding.role.followerBody')}
        selected={answers.role === 'follower'}
        onPress={() => onAnswer({ role: 'follower' })}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          selectionTick();
          onAnswer({ role: 'browser' });
        }}
        style={styles.link}
      >
        <Text style={[styles.linkText, { color: colors.textSecondary }]}>
          {t('onboarding.role.browser')}
        </Text>
      </Pressable>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  link: { alignItems: 'center', paddingVertical: 16 },
  linkText: { fontSize: 14, textDecorationLine: 'underline' },
});
