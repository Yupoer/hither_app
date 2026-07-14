import React, { useCallback, useState } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { HitherText } from '../../components/HitherText';
import { useTheme } from '../../state/PreferencesContext';
import { useTranslation } from '../../i18n';
import { location, notifications } from '../../native';
import { accentMix } from '../../glass';
import { OnboardingIcons } from '../icons';
import type { StepProps } from '../types';
import StepShell from './StepShell';
import PrimaryButton from './PrimaryButton';

/**
 * Shared second onboarding page: explain why Hither needs notifications +
 * foreground location, then request both OS prompts on Continue.
 * Denial never blocks advancement — the rest of the app already degrades
 * gracefully without either grant.
 */
function PermissionInfoRow({
  icon,
  title,
  body,
}: {
  icon: ImageSourcePropType;
  title: string;
  body: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.tile,
          { backgroundColor: accentMix(colors.textSecondary, 10) },
        ]}
      >
        <Image source={icon} style={styles.icon} resizeMode="contain" accessibilityIgnoresInvertColors />
      </View>
      <View style={styles.textCol}>
        <HitherText typeRole="body" style={[styles.rowTitle, { color: colors.textPrimary }]}>
          {title}
        </HitherText>
        <HitherText typeRole="footnote" style={[styles.rowBody, { color: colors.textSecondary }]}>
          {body}
        </HitherText>
      </View>
    </View>
  );
}

export default function PermissionsStep({ onAnswer, onSkip, onBack }: StepProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const handleContinue = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Sequential prompts so iOS shows one dialog at a time with prior context.
      await notifications.requestPermission();
      await location.requestPermission();
    } catch {
      // Best-effort: still advance so onboarding is never stuck on OS errors.
    } finally {
      setBusy(false);
      onAnswer({});
    }
  }, [busy, onAnswer]);

  return (
    <StepShell
      step="permissions"
      role={undefined}
      kicker={t('onboarding.permissions.kicker')}
      title={t('onboarding.permissions.title')}
      subtitle={t('onboarding.permissions.subtitle')}
      onBack={onBack}
      onSkip={onSkip}
      footer={
        <PrimaryButton
          label={t('onboarding.continue')}
          onPress={() => {
            void handleContinue();
          }}
          disabled={busy}
        />
      }
    >
      <View style={styles.list}>
        <PermissionInfoRow
          icon={OnboardingIcons.bell}
          title={t('onboarding.permissions.notifications.title')}
          body={t('onboarding.permissions.notifications.body')}
        />
        <PermissionInfoRow
          icon={OnboardingIcons.pin}
          title={t('onboarding.permissions.location.title')}
          body={t('onboarding.permissions.location.body')}
        />
      </View>
    </StepShell>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, paddingTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 76,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  tile: {
    width: 56,
    height: 56,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { width: 42, height: 42 },
  textCol: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16.5, fontWeight: '700' },
  rowBody: { fontSize: 12.5, marginTop: 2, lineHeight: 18 },
});
