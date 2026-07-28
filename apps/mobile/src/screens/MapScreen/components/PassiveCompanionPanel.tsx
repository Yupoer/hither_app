import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { glass } from '../../../glass';
import { useTranslation } from '../../../i18n';
import { mediumTap } from '../../../utils/haptics';
import type {
  CoarseProgressBucket,
  PassiveCompanionModel,
  TeamGatheringPhase,
} from '../../../utils/passiveCompanion';
import type { Destination } from '../../../types';
import { HitherText } from '../../../components/HitherText';
import QuickCommandsCard from '../../../components/QuickCommandsCard';
import { useFontLayout } from '../../../a11y/useFontScaleBucket';
import { spacing, radius, themes, type Palette } from '../../../theme';
import { TYPE_BASE } from '../../../theme/typeScale';

function makePassiveStyles(scale: number) {
  const s = (value: number, min = 0) => Math.max(min, Math.round(value * scale));
  return StyleSheet.create({
    root: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(10, 16, 28, 0.94)',
      paddingHorizontal: spacing.lg,
      zIndex: 40,
      justifyContent: 'flex-start',
    },
    headerRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: spacing.lg, gap: spacing.md,
    },
    // Shared TYPE_BASE + HitherText typeRole — no exclusive 28/800 hero title.
    kicker: {
      color: glass.textSecondary,
      fontSize: TYPE_BASE.footnote,
      fontWeight: '600',
      flexShrink: 1,
    },
    switchBack: {
      minHeight: s(54, 48), paddingHorizontal: spacing.lg, borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    },
    switchBackLabel: { color: '#111', fontSize: TYPE_BASE.callout, fontWeight: '600' },
    card: {
      backgroundColor: glass.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.hairlineSoft, padding: spacing.lg, minHeight: 220,
    },
    centerBlock: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: s(32, 28) },
    errorBanner: {
      flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md,
      backgroundColor: 'rgba(255, 107, 107, 0.12)', borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255, 107, 107, 0.35)',
    },
    errorBannerText: {
      flex: 1,
      color: glass.danger,
      fontSize: TYPE_BASE.callout,
      fontWeight: '500',
      lineHeight: 20,
    },
    fieldLabel: {
      color: glass.textTertiary,
      fontSize: TYPE_BASE.caption,
      fontWeight: '600',
      letterSpacing: 0.35,
      textTransform: 'uppercase',
    },
    fieldGap: { marginTop: spacing.lg },
    pointTitle: {
      color: glass.textPrimary,
      fontSize: TYPE_BASE.title,
      fontWeight: '600',
      marginTop: spacing.sm,
      marginBottom: spacing.md,
    },
    primary: {
      color: glass.textPrimary,
      fontSize: TYPE_BASE.body,
      fontWeight: '600',
      textAlign: 'center',
    },
    secondary: {
      color: glass.textSecondary,
      fontSize: TYPE_BASE.body,
      fontWeight: '400',
      marginTop: spacing.xs,
    },
    phasePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
    phaseDot: { width: 10, height: 10, borderRadius: 5 },
    phaseText: { fontSize: TYPE_BASE.callout, fontWeight: '600' },
    progressTrack: { marginTop: spacing.sm, height: 8, borderRadius: 4, backgroundColor: glass.fillStrong, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 4 },
    actions: { marginTop: spacing.lg },
    actionBtn: { minHeight: s(58, 54), flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md },
    actionPrimary: {},
    actionPrimaryLabel: { color: '#111', fontSize: TYPE_BASE.callout, fontWeight: '600' },
    quickLabel: { marginTop: spacing.xl, marginBottom: spacing.sm, color: glass.textSecondary },
    quickWrap: { marginTop: spacing.sm },
    footnote: {
      marginTop: spacing.lg,
      color: glass.textTertiary,
      fontSize: TYPE_BASE.footnote,
      fontWeight: '400',
      lineHeight: 18,
      textAlign: 'center',
    },
  });
}

export interface PassiveCompanionPanelProps {
  model: PassiveCompanionModel;
  accent: string;
  groupId: string | null;
  isLeader?: boolean;
  /** Destination used for external maps (current point when coordinates known). */
  navigationDestination?: Destination | null;
  onSwitchBack: () => void;
  onOpenExternalNavigation: (dest: Destination) => void;
  /** Same custom-command editor as full-mode「全部快捷指令」. */
  onConfigureCustom?: (slot: number) => void;
}

function phaseLabelKey(phase: TeamGatheringPhase): 'passive.phaseStaying' | 'passive.phaseEnRoute' {
  return phase === 'en_route' ? 'passive.phaseEnRoute' : 'passive.phaseStaying';
}

function progressLabelKey(
  bucket: CoarseProgressBucket,
):
  | 'passive.progressUnknown'
  | 'passive.progressNotStarted'
  | 'passive.progressEarly'
  | 'passive.progressMid'
  | 'passive.progressLate'
  | 'passive.progressArrived' {
  switch (bucket) {
    case 'not_started':
      return 'passive.progressNotStarted';
    case 'early':
      return 'passive.progressEarly';
    case 'mid':
      return 'passive.progressMid';
    case 'late':
      return 'passive.progressLate';
    case 'arrived':
      return 'passive.progressArrived';
    case 'unknown':
    default:
      return 'passive.progressUnknown';
  }
}

/**
 * Minimal passive-companion presentation: team gathering state + personal
 * progress, external nav, full quick-command catalogue (same as「全部快捷指令」),
 * and an always-available switch-back button.
 *
 * Does not open paywall, vote, or safety flows. Commands are explicit taps only.
 */
export const PassiveCompanionPanel = React.memo(function PassiveCompanionPanel({
  model,
  accent,
  groupId,
  isLeader = false,
  navigationDestination,
  onSwitchBack,
  onOpenExternalNavigation,
  onConfigureCustom,
}: PassiveCompanionPanelProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const fontLayout = useFontLayout();
  const styles = useMemo(() => makePassiveStyles(fontLayout.scale), [fontLayout.scale]);
  // Reuse the night palette so QuickCommandsCard matches full-mode sheet.
  const commandColors: Palette = themes.night;

  const handleSwitchBack = useCallback(() => {
    mediumTap();
    onSwitchBack();
  }, [onSwitchBack]);

  const handleExternalNav = useCallback(() => {
    if (!navigationDestination) {
      Alert.alert(t('passive.noPointTitle'), t('passive.noPointBody'));
      return;
    }
    mediumTap();
    onOpenExternalNavigation(navigationDestination);
  }, [navigationDestination, onOpenExternalNavigation, t]);

  const handleConfigureCustom = useCallback(
    (slot: number) => {
      onConfigureCustom?.(slot);
    },
    [onConfigureCustom],
  );

  const phaseKey = phaseLabelKey(model.teamPhase);
  const progressKey = progressLabelKey(model.coarseProgress);

  return (
    <View
      style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}
      accessibilityViewIsModal
      testID="passive-companion-panel"
    >
      <View style={styles.headerRow}>
        <HitherText typeRole="title" style={styles.kicker} accessibilityRole="header">
          {t('passive.title')}
        </HitherText>
        <Pressable
          onPress={handleSwitchBack}
          style={[styles.switchBack, { borderColor: accent, backgroundColor: accent }]}
          accessibilityRole="button"
          accessibilityLabel={t('passive.switchBack')}
          testID="passive-switch-back"
          // Always interactive — including loading / empty / error.
          disabled={false}
        >
          <Ionicons name="expand-outline" size={16} color="#111" />
          <HitherText typeRole="callout" style={styles.switchBackLabel}>
            {t('passive.switchBack')}
          </HitherText>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.card}>
        {model.contentStatus === 'loading' ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={accent} />
            <HitherText typeRole="body" style={styles.secondary}>{t('passive.loading')}</HitherText>
          </View>
        ) : null}

        {/* Exclusive error only when there is no cached companion content. */}
        {model.contentStatus === 'error' ? (
          <View style={styles.centerBlock}>
            <Ionicons name="warning-outline" size={28} color={glass.danger} />
            <HitherText typeRole="body" style={styles.primary}>
              {model.errorMessage?.trim() || t('passive.error')}
            </HitherText>
          </View>
        ) : null}

        {model.contentStatus === 'empty' ? (
          <View style={styles.centerBlock}>
            <HitherText typeRole="body" style={styles.primary}>{t('passive.empty')}</HitherText>
            <HitherText typeRole="body" style={styles.secondary}>{t('passive.emptyHint')}</HitherText>
          </View>
        ) : null}

        {/* Ready (incl. error-with-cache): always show required companion fields. */}
        {model.contentStatus === 'ready' ? (
          <>
            {model.errorMessage ? (
              <View
                style={styles.errorBanner}
                accessibilityRole="text"
                testID="passive-error-banner"
              >
                <Ionicons name="warning-outline" size={18} color={glass.danger} />
                <HitherText typeRole="callout" style={styles.errorBannerText} numberOfLines={3}>
                  {model.errorMessage.trim() || t('passive.error')}
                </HitherText>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>{t('passive.currentPoint')}</Text>
            <HitherText typeRole="title" style={styles.pointTitle} numberOfLines={3}>
              {model.currentPoint?.title ?? t('passive.noCurrentPoint')}
            </HitherText>

            <View style={[styles.phasePill, { backgroundColor: accent + '33' }]}>
              <View style={[styles.phaseDot, { backgroundColor: accent }]} />
              <HitherText typeRole="callout" style={[styles.phaseText, { color: accent }]}>
                {t(phaseKey)}
              </HitherText>
            </View>

            <Text style={[styles.fieldLabel, styles.fieldGap]}>
              {t('passive.nextPoint')}
            </Text>
            <HitherText typeRole="body" style={styles.secondary} numberOfLines={2}>
              {model.nextPoint?.title ?? t('passive.noNextPoint')}
            </HitherText>

            <Text style={[styles.fieldLabel, styles.fieldGap]}>
              {t('passive.personalProgress')}
            </Text>
            <HitherText typeRole="body" style={styles.secondary}>{t(progressKey)}</HitherText>
            {model.personalFreshness === 'stale' || model.personalFreshness === 'unknown' ? (
              <HitherText
                typeRole="callout"
                style={[styles.secondary, { marginTop: 4 }]}
                testID="passive-progress-freshness"
              >
                {t('locationUpdate.stale')}
              </HitherText>
            ) : null}
            {model.personalProgress != null ? (
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.round(model.personalProgress * 100)}%`,
                      backgroundColor: accent,
                    },
                  ]}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.actionBtn, styles.actionPrimary, { backgroundColor: accent }]}
          onPress={handleExternalNav}
          accessibilityRole="button"
          accessibilityLabel={t('map.openExternalNavigation')}
          testID="passive-external-nav"
        >
          <Ionicons name="map" size={24} color="#111" />
          <HitherText typeRole="callout" style={styles.actionPrimaryLabel}>{t('passive.externalNav')}</HitherText>
        </Pressable>
      </View>

      <HitherText typeRole="callout" style={[styles.fieldLabel, styles.quickLabel]}>
        {t('passive.quickCommands')}
      </HitherText>
      {/* Same catalogue + role gating + custom slots as full-mode「全部快捷指令」. */}
      <View style={styles.quickWrap} testID="passive-quick-commands">
        {groupId ? (
          <QuickCommandsCard
            groupId={groupId}
            isLeader={isLeader}
            colors={commandColors}
            onConfigureCustom={handleConfigureCustom}
            variant="full"
          />
        ) : null}
      </View>

      <HitherText typeRole="caption" style={styles.footnote}>{t('passive.noAutoConsent')}</HitherText>
      </ScrollView>
    </View>
  );
});

/* Styles are generated by makePassiveStyles so Dynamic Type also scales hit targets. */
