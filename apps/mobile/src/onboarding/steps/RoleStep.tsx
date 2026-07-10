import React, { useState } from 'react';
import { useTranslation } from '../../i18n';
import type { OnboardingRole, StepProps } from '../types';
import StepShell from './StepShell';
import OptionCard from './OptionCard';
import PrimaryButton from './PrimaryButton';

export default function RoleStep({ answers, onAnswer, onSkip, onBack }: StepProps) {
  const { t } = useTranslation();
  const [role, setRole] = useState<OnboardingRole | undefined>(answers.role);

  return (
    <StepShell
      step="role"
      role={answers.role}
      kicker={t('onboarding.role.kicker')}
      title={t('onboarding.role.title')}
      onBack={onBack}
      onSkip={onSkip}
      footer={
        <PrimaryButton
          label={t('onboarding.continue')}
          disabled={!role}
          onPress={() => role && onAnswer({ role })}
        />
      }
    >
      <OptionCard
        emoji="🪝"
        title={t('onboarding.role.leaderTitle')}
        subtitle={t('onboarding.role.leaderBody')}
        selected={role === 'leader'}
        onPress={() => setRole('leader')}
      />
      <OptionCard
        emoji="🐑"
        title={t('onboarding.role.followerTitle')}
        subtitle={t('onboarding.role.followerBody')}
        selected={role === 'follower'}
        onPress={() => setRole('follower')}
      />
      <OptionCard
        emoji="👀"
        title={t('onboarding.role.browser')}
        selected={role === 'browser'}
        onPress={() => setRole('browser')}
      />
    </StepShell>
  );
}
